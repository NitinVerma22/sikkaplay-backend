import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const getArrowEscapeProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    let currentLevel = 1;

    if (userId) {
      const sessions = await prisma.gameSession.count({
        where: { userId, gameType: 'arrow_escape', status: 'completed' },
      });
      // Cyclic progression: 1 to 15
      currentLevel = (sessions % 15) + 1;
    }

    res.status(200).json({
      success: true,
      maxUnlockedLevel: currentLevel,
      stars: {},
      multiplier: 1
    });
  } catch (error) {
    console.error('Error fetching arrow escape progress:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch arrow escape progress' });
  }
};

export const completeArrowEscapeLevel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    const { levelNumber, isMilestoneClaim } = req.body;

    if (!levelNumber || levelNumber < 1 || levelNumber > 15) {
      res.status(400).json({ success: false, error: 'Invalid level number' });
      return;
    }

    let coinsEarned = 0;
    if (isMilestoneClaim) {
      if (levelNumber === 5) coinsEarned = 30;
      else if (levelNumber === 10) coinsEarned = 70;
      else if (levelNumber === 15) coinsEarned = 150;
      else {
        res.status(400).json({ success: false, error: 'Not a valid milestone level' });
        return;
      }
    }

    if (userId) {
      // Check if user is actually on this level
      const sessionsCount = await prisma.gameSession.count({
        where: { userId, gameType: 'arrow_escape', status: 'completed' },
      });
      const expectedLevel = (sessionsCount % 15) + 1;
      
      if (levelNumber !== expectedLevel) {
         res.status(400).json({ success: false, error: 'Level mismatch. You cannot play this level right now.' });
         return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'arrow_escape',
            coinsEarned,
            status: 'completed'
          }
        });

        if (coinsEarned > 0) {
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
              description: `Arrow Escape Level ${levelNumber} Milestone Reward`
            }
          });
        }
      });
      
      res.status(200).json({
        success: true,
        coinsEarned,
        newUnlockedLevel: ((sessionsCount + 1) % 15) + 1
      });
    } else {
       res.status(401).json({ success: false, error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Error completing arrow escape level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};
