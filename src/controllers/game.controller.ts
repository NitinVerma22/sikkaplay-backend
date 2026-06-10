import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getStartOfTodayIST } from '../utils/date.utils';

export const startGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { gameType } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!gameType || typeof gameType !== 'string') {
      res.status(400).json({ error: 'Invalid game type' });
      return;
    }

    // Invalidate any existing active sessions for this user and gameType to prevent multi-session exploits
    await prisma.gameSession.updateMany({
      where: {
        userId,
        gameType,
        status: 'active'
      },
      data: {
        status: 'invalidated'
      }
    });

    // Create a new session
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameType,
        status: 'active'
      }
    });

    let spinsLeft = 3;
    if (gameType === 'spin') {
      const today = new Date();
      const startOfToday = getStartOfTodayIST(today);

      const adsToday = await prisma.adImpression.count({
        where: {
          userId,
          adType: 'rewarded_spin',
          createdAt: { gte: startOfToday }
        }
      });

      const spinsToday = await prisma.transaction.count({
        where: {
          userId,
          type: 'game',
          description: { startsWith: 'Spin reward won:' },
          createdAt: { gte: startOfToday }
        }
      });

      spinsLeft = Math.max(0, 3 + adsToday * 3 - spinsToday);
    }

    res.status(200).json({
      success: true,
      sessionId: session.id,
      spinsLeft,
      message: 'Game session started successfully'
    });
  } catch (error) {
    console.error('Error starting game session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const spinWheel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { sessionId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    // Find the session and lock user row to prevent concurrency race conditions
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUnique({
        where: { id: sessionId }
      });

      if (!session || session.userId !== userId || session.status !== 'active' || session.gameType !== 'spin') {
        throw new Error('Invalid or inactive spin session');
      }

      // Calculate remaining spins
      const today = new Date();
      const startOfToday = getStartOfTodayIST(today);

      const adsToday = await tx.adImpression.count({
        where: {
          userId,
          adType: 'rewarded_spin',
          createdAt: { gte: startOfToday }
        }
      });

      const spinsToday = await tx.transaction.count({
        where: {
          userId,
          type: 'game',
          description: { startsWith: 'Spin reward won:' },
          createdAt: { gte: startOfToday }
        }
      });

      const spinsLeft = 3 + adsToday * 3 - spinsToday;
      if (spinsLeft <= 0) {
        throw new Error('No spins remaining today');
      }

      // Lock the user row to prevent balance race conditions
      const users = await tx.$queryRawUnsafe<any[]>(
        'SELECT balance, "totalEarned" FROM "User" WHERE id = $1 FOR UPDATE',
        userId
      );

      if (!users || users.length === 0) {
        throw new Error('User not found');
      }

      // Generate a spin reward matching the client's wheel slots: 1, 2, 3, 5, 7, 10, 15, 20, 30
      const rand = Math.random() * 100;
      let reward = 1;
      if (rand < 0.01) {
        reward = 30; // Ultra rare
      } else if (rand < 5.0) {
        reward = Math.random() > 0.5 ? 15 : 20; // Rare
      } else if (rand < 20.0) {
        reward = Math.random() > 0.5 ? 7 : 10; // Medium
      } else {
        const common = [1, 2, 3, 5];
        reward = common[Math.floor(Math.random() * common.length)]; // Common
      }

      // Update User balance and total earned (spin is free, only increment reward)
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: reward > 0 ? { increment: reward } : undefined,
          totalEarned: reward > 0 ? { increment: reward } : undefined
        }
      });

      // Update session's coinsEarned accumulator (winnings)
      await tx.gameSession.update({
        where: { id: sessionId },
        data: {
          coinsEarned: { increment: reward }
        }
      });

      // Create transaction logs
      // Credit reward if won
      if (reward > 0) {
        await tx.transaction.create({
          data: {
            userId,
            amount: reward,
            type: 'game',
            status: 'success',
            description: `Spin reward won: ${reward} Sikka`
          }
        });
      }

      return { reward, balance: updatedUser.balance, spinsLeft: spinsLeft - 1 };
    });

    res.status(200).json({
      success: true,
      reward: result.reward,
      balance: result.balance,
      spinsLeft: result.spinsLeft,
      message: 'Wheel spun successfully'
    });
  } catch (error: any) {
    console.error('Error spinning wheel:', error);
    res.status(400).json({ error: error.message || 'Internal server error' });
  }
};

export const endGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { sessionId, coinsEarned: reqCoins, bypassFee } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const requestedCoins = typeof reqCoins === 'number' ? Math.floor(reqCoins) : 0;
    const fee = typeof bypassFee === 'number' ? Math.floor(bypassFee) : 0;

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUnique({
        where: { id: sessionId }
      });

      if (!session || session.userId !== userId || session.status !== 'active') {
        throw new Error('Invalid or inactive game session');
      }

      const now = new Date();
      const elapsedSeconds = (now.getTime() - session.startTime.getTime()) / 1000;

      // Invalidate if session was active for less than 1 second to prevent spamming
      if (elapsedSeconds < 1) {
        await tx.gameSession.update({
          where: { id: sessionId },
          data: { status: 'invalidated', endTime: now }
        });
        throw new Error('Game session ended too quickly');
      }

      let finalCoinsEarned = 0;

      if (session.gameType !== 'spin') {
        // Enforce maximum possible coins limit based on game type and duration to prevent client-side hacks
        let maxAllowedCoins = 0;
        if (session.gameType === 'emoji_memory') {
          // Average round duration is ~6-8 seconds. Let's cap at 1.25 coins per elapsed second with an absolute cap of 80 coins.
          maxAllowedCoins = Math.min(Math.floor(elapsedSeconds * 1.25), 80);
        } else if (session.gameType === 'math_rush') {
          // Average solve speed is ~1 second for 2 coins. Let's cap at 2.5 coins per elapsed second with an absolute cap of 80 coins.
          maxAllowedCoins = Math.min(Math.floor(elapsedSeconds * 2.5), 80);
        } else if (session.gameType === 'treasure_grid') {
          // Average round is ~4 seconds for up to 8 coins. Let's cap at 2.5 coins per elapsed second with an absolute cap of 80 coins.
          maxAllowedCoins = Math.min(Math.floor(elapsedSeconds * 2.5), 80);
        } else {
          maxAllowedCoins = Math.min(Math.floor(elapsedSeconds * 2.0), 80);
        }

        // Validate client requested coins against allowed limits
        if (requestedCoins > maxAllowedCoins) {
          console.warn(`[SECURITY WARNING] User ${userId} requested ${requestedCoins} coins for game ${session.gameType} but session duration of ${elapsedSeconds}s only permits up to ${maxAllowedCoins} coins.`);
          finalCoinsEarned = maxAllowedCoins;
        } else {
          finalCoinsEarned = requestedCoins;
        }

        // Verify if user can afford the bypass fee if selected
        if (fee > 0) {
          const userCheck = await tx.user.findUnique({
            where: { id: userId },
            select: { balance: true }
          });
          if ((userCheck?.balance ?? 0) + finalCoinsEarned < fee) {
            throw new Error('Insufficient balance to pay bypass fee');
          }
        }

        if (finalCoinsEarned > 0 || fee > 0) {
          // Update User balance (net increase is earned - fee)
          await tx.user.update({
            where: { id: userId },
            data: {
              balance: { increment: finalCoinsEarned - fee },
              totalEarned: { increment: finalCoinsEarned }
            }
          });

          // Create transaction record for rewards
          if (finalCoinsEarned > 0) {
            await tx.transaction.create({
              data: {
                userId,
                amount: finalCoinsEarned,
                type: 'game',
                status: 'success',
                description: `Completed ${session.gameType} gameplay reward`
              }
            });
          }

          // Create transaction record for fee
          if (fee > 0) {
            await tx.transaction.create({
              data: {
                userId,
                amount: -fee,
                type: 'game',
                status: 'success',
                description: `Bypassed video ad fee for ${session.gameType}`
              }
            });
          }
        }
      } else {
        // Spin sessions already award coins per spin action, so endGame just closes the session
        finalCoinsEarned = session.coinsEarned;
      }

      // Mark session completed
      const updatedSession = await tx.gameSession.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          endTime: now,
          coinsEarned: session.gameType !== 'spin' ? finalCoinsEarned : undefined
        }
      });

      // Get final user balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      });

      return { coinsEarned: finalCoinsEarned, balance: user?.balance || 0, session: updatedSession };
    });

    res.status(200).json({
      success: true,
      coinsEarned: result.coinsEarned,
      balance: result.balance,
      message: 'Game session ended successfully'
    });
  } catch (error: any) {
    console.error('Error ending game session:', error);
    res.status(400).json({ error: error.message || 'Internal server error' });
  }
};

export const recordSpinAd = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const today = new Date();
    const startOfToday = getStartOfTodayIST(today);

    // Create an ad impression record
    await prisma.adImpression.create({
      data: {
        userId,
        adType: 'rewarded_spin',
        adNetwork: 'admob',
        coinsAwarded: 0,
        externalTxId: `spin-ad-${userId}-${Date.now()}`
      }
    });

    // Calculate updated spinsLeft
    const adsToday = await prisma.adImpression.count({
      where: {
        userId,
        adType: 'rewarded_spin',
        createdAt: { gte: startOfToday }
      }
    });

    const spinsToday = await prisma.transaction.count({
      where: {
        userId,
        type: 'game',
        description: { startsWith: 'Spin reward won:' },
        createdAt: { gte: startOfToday }
      }
    });

    const spinsLeft = Math.max(0, 3 + adsToday * 3 - spinsToday);

    res.status(200).json({
      success: true,
      spinsLeft,
      message: 'Ad watch recorded successfully. 3 spins added.'
    });
  } catch (error) {
    console.error('Error recording spin ad:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
