import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const getBubbleShooterProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    let maxUnlockedLevel = 1;
    let starsMap: Record<number, number> = {};
    let multiplier = 2; // Default multiplier

    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).bubbleShooterMultiplier) {
      multiplier = (config as any).bubbleShooterMultiplier;
    }

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { bubbleShooterLevel: true }
      });
      if (user) {
        maxUnlockedLevel = user.bubbleShooterLevel;
        for (let i = 1; i < maxUnlockedLevel; i++) {
          starsMap[i] = 3;
        }
      }
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
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
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

    // Coins are now exclusively awarded via AdMob SSV Checkpoints (milestones)
    const coinsEarned = 0;

    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { bubbleShooterLevel: true } });
      const currentMax = user?.bubbleShooterLevel || 1;
      const newMaxLevel = Math.max(currentMax, levelNumber + 1);

      await prisma.$transaction(async (tx) => {
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'bubble_shooter',
            coinsEarned,
            status: 'completed'
          }
        });

        // Update max unlocked level
        await tx.user.update({
          where: { id: userId },
          data: {
            bubbleShooterLevel: newMaxLevel
          }
        });
      });
    }

    res.status(200).json({
      success: true,
      coinsEarned: 0,
      newUnlockedLevel: levelNumber + 1
    });
  } catch (error) {
    console.error('Error completing bubble shooter level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};
