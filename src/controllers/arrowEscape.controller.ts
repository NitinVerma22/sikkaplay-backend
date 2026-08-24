import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const getArrowEscapeProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    let maxUnlockedLevel = 1;
    let starsMap: Record<number, number> = {};
    let multiplier = 2;

    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).arrowEscapeMultiplier) {
      multiplier = (config as any).arrowEscapeMultiplier;
    }

    if (userId) {
      const sessions = await prisma.gameSession.findMany({
        where: { userId, gameType: 'arrow_escape', status: 'completed' },
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
    console.error('Error fetching arrow escape progress:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch arrow escape progress' });
  }
};

export const completeArrowEscapeLevel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    const { levelNumber, stars, score } = req.body;

    if (!levelNumber || levelNumber < 1) {
      res.status(400).json({ success: false, error: 'Invalid level number' });
      return;
    }

    let multiplier = 2;
    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).arrowEscapeMultiplier) {
      multiplier = (config as any).arrowEscapeMultiplier;
    }

    const coinsEarned = levelNumber * multiplier;

    if (userId) {
      await prisma.$transaction(async (tx) => {
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'arrow_escape',
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
            description: `Arrow Escape Level ${levelNumber} Reward`
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
    console.error('Error completing arrow escape level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};
