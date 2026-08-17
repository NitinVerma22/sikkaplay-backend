import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

/**
 * GET /api/v1/water-sort/progress
 * Fetch user progress and current global coin multiplier N from Admin AppConfig.
 */
export const getWaterSortProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.uid || req.user?.id;
    let maxUnlockedLevel = 1;
    let starsMap: Record<number, number> = {};
    let multiplier = 2; // Default multiplier

    // 1. Fetch multiplier N from AppConfig
    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).waterSortMultiplier) {
      multiplier = (config as any).waterSortMultiplier;
    }

    // 2. Fetch user's recorded water sort level if authenticated
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { totalEarned: true }
      });
      if (user) {
        // Fetch completed levels from game sessions or user progress
        const sessions = await prisma.gameSession.findMany({
          where: { userId, gameType: 'water_sort', status: 'completed' },
          select: { coinsEarned: true, createdAt: true }
        });

        maxUnlockedLevel = Math.max(1, sessions.length + 1);
        sessions.forEach((s, idx) => {
          starsMap[idx + 1] = 3;
        });
      }
    }

    res.status(200).json({
      success: true,
      maxUnlockedLevel,
      stars: starsMap,
      multiplier
    });
  } catch (error) {
    console.error('Error fetching water sort progress:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch water sort progress' });
  }
};

/**
 * POST /api/v1/water-sort/complete-level
 * Validates level completion, awards coins (levelNumber * N), creates transaction, and unlocks next level.
 */
export const completeWaterSortLevel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.uid || req.user?.id;
    const { levelNumber, stars, movesCount } = req.body;

    if (!levelNumber || levelNumber < 1) {
      res.status(400).json({ success: false, error: 'Invalid level number' });
      return;
    }

    // 1. Fetch Multiplier N from AppConfig
    let multiplier = 2;
    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).waterSortMultiplier) {
      multiplier = (config as any).waterSortMultiplier;
    }

    const coinsEarned = levelNumber * multiplier;

    if (userId) {
      await prisma.$transaction(async (tx) => {
        // Record game session
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'water_sort',
            coinsEarned,
            status: 'completed'
          }
        });

        // Credit user balance
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { increment: coinsEarned },
            totalEarned: { increment: coinsEarned }
          }
        });

        // Create transaction record
        await tx.transaction.create({
          data: {
            userId,
            amount: coinsEarned,
            type: 'earning',
            status: 'success',
            description: `Water Sort Level ${levelNumber} Reward`
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
    console.error('Error completing water sort level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};
