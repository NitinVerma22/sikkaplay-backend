import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const getBubbleShooterProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.uid || req.user?.id;
    let maxUnlockedLevel = 1;
    let starsMap: Record<number, number> = {};
    let multiplier = 2; // Default multiplier

    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).bubbleShooterMultiplier) {
      multiplier = (config as any).bubbleShooterMultiplier;
    }

    if (userId) {
      const sessions = await prisma.gameSession.findMany({
        where: { userId, gameType: 'bubble_shooter', status: 'completed' },
        select: { coinsEarned: true, createdAt: true }
      });

      maxUnlockedLevel = Math.max(1, sessions.length + 1);
      sessions.forEach((s, idx) => {
        starsMap[idx + 1] = 3;
      });
    }

    res.status(200).json({
      success: true,
      maxUnlockedLevel,
      stars: starsMap,
      multiplier
    });
  } catch (error) {
    console.error('Error fetching bubble shooter progress:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch bubble shooter progress' });
  }
};

export const completeBubbleShooterLevel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.uid || req.user?.id;
    const { levelNumber, stars, score } = req.body;

    if (!levelNumber || levelNumber < 1) {
      res.status(400).json({ success: false, error: 'Invalid level number' });
      return;
    }

    let multiplier = 2;
    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).bubbleShooterMultiplier) {
      multiplier = (config as any).bubbleShooterMultiplier;
    }

    const coinsEarned = levelNumber * multiplier;

    if (userId) {
      await prisma.$transaction(async (tx) => {
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'bubble_shooter',
            coinsEarned,
            status: 'completed'
          }
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { increment: coinsEarned },
            totalEarned: { increment: coinsEarned }
          }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: coinsEarned,
            type: 'game',
            status: 'success',
            description: `Bubble Shooter Level ${levelNumber} Reward`
          }
        });
      });
    }

    res.status(200).json({
      success: true,
      coinsEarned,
      newUnlockedLevel: levelNumber + 1
    });
  } catch (error) {
    console.error('Error completing bubble shooter level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};
