import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

export class WaterSortController {
  /**
   * GET /api/v1/water-sort/progress
   * Returns user's highest unlocked level, stars map, and global multiplier N
   */
  async getProgress(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      // Fetch global app settings for multiplier N
      const config = await prisma.appConfig.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      const multiplier = (config as any)?.waterSortCoinMultiplier ?? 2;

      // Fetch user's water sort progress
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          waterSortMaxLevel: true,
          waterSortStars: true,
        } as any
      });

      const maxUnlockedLevel = (user as any)?.waterSortMaxLevel ?? 1;
      const stars = (user as any)?.waterSortStars ?? {};

      return res.json({
        success: true,
        maxUnlockedLevel,
        stars,
        multiplier,
      });
    } catch (error) {
      console.error('Error fetching water sort progress:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * POST /api/v1/water-sort/complete-level
   * Completes a level, credits coins = levelNumber * multiplier N, and unlocks next level
   */
  async completeLevel(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { levelNumber, stars, movesCount } = req.body;
      if (!levelNumber || levelNumber < 1) {
        return res.status(400).json({ success: false, message: 'Invalid level number' });
      }

      // Fetch global multiplier N
      const config = await prisma.appConfig.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      const multiplier = (config as any)?.waterSortCoinMultiplier ?? 2;

      // Calculate coin reward = Level * N
      const coinsEarned = levelNumber * multiplier;

      // Fetch user
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const currentMax = (user as any).waterSortMaxLevel ?? 1;
      const nextMax = Math.max(currentMax, levelNumber + 1);

      let currentStars: Record<string, number> = {};
      try {
        currentStars = typeof (user as any).waterSortStars === 'object' && (user as any).waterSortStars
          ? (user as any).waterSortStars
          : {};
      } catch (e) {
        currentStars = {};
      }

      // Update stars for this level if higher
      const prevStars = currentStars[levelNumber.toString()] || 0;
      if (stars > prevStars) {
        currentStars[levelNumber.toString()] = stars;
      }

      // Execute transaction: update coins & level progress
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            coins: { increment: coinsEarned },
            waterSortMaxLevel: nextMax,
            waterSortStars: currentStars,
          } as any,
        }),
        prisma.transaction.create({
          data: {
            userId: userId,
            type: 'GAME_REWARD',
            amount: coinsEarned,
            description: `Water Sort Level ${levelNumber} Reward (${stars}⭐)`,
            status: 'COMPLETED',
          },
        }),
      ]);

      return res.json({
        success: true,
        coinsEarned,
        newUnlockedLevel: nextMax,
        stars: currentStars,
      });
    } catch (error) {
      console.error('Error completing water sort level:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
