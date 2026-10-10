import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { TournamentService } from '../services/tournament.service';

/**
 * GET /api/v1/water-sort/progress
 * Fetch user progress and current global coin multiplier N from Admin AppConfig.
 */
export const getWaterSortProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
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
        select: { waterSortLevel: true }
      });
      if (user) {
        maxUnlockedLevel = user.waterSortLevel;
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
    const userId = req.user?.userId || req.user?.uid || req.user?.id;
    const { levelNumber, stars, movesCount, isMilestoneClaim, tournamentId } = req.body;

    if (!levelNumber || levelNumber < 1) {
      res.status(400).json({ success: false, error: 'Invalid level number' });
      return;
    }

    // 1. Fetch Multiplier N from AppConfig (No longer used for coins)
    let multiplier = 2;
    const config = await prisma.appConfig.findFirst();
    if (config && (config as any).waterSortMultiplier) {
      multiplier = (config as any).waterSortMultiplier;
    }

    // Coins are now exclusively awarded via AdMob SSV Checkpoints (milestones)
    let coinsEarned = 0;
    if (isMilestoneClaim) {
      if (levelNumber === 5) coinsEarned = 40;
      else if (levelNumber === 10) coinsEarned = 55;
      else if (levelNumber === 15) coinsEarned = 105;
    }

    let tournamentScoreResult: any = null;

    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { waterSortLevel: true } });
      const currentMax = user?.waterSortLevel || 1;
      const newMaxLevel = Math.max(currentMax, levelNumber + 1);

      await prisma.$transaction(async (tx) => {
        // Record game session
        await tx.gameSession.create({
          data: {
            userId,
            gameType: 'water_sort',
            tournamentId: typeof tournamentId === 'string' ? tournamentId : null,
            coinsEarned,
            status: 'completed'
          }
        });

        // Update user's max unlocked level
        await tx.user.update({
          where: { id: userId },
          data: {
            waterSortLevel: newMaxLevel,
            ...(coinsEarned > 0 && {
              balance: { increment: coinsEarned },
              totalEarned: { increment: coinsEarned }
            })
          }
        });

        if (coinsEarned > 0) {
          await tx.transaction.create({
            data: {
              userId,
              amount: coinsEarned,
              type: 'game',
              status: 'success',
              description: `Water Sort Level ${levelNumber} Milestone Reward`
            }
          });

          if (tournamentId && typeof tournamentId === 'string') {
            tournamentScoreResult = await TournamentService.recordTournamentScore({
              userId,
              tournamentId,
              coinsEarned,
              gameType: 'water_sort',
              tx
            });
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      coinsEarned,
      newUnlockedLevel: levelNumber + 1,
      tournamentScore: tournamentScoreResult?.newScore,
      tournamentPointsAwarded: tournamentScoreResult?.pointsAwarded || 0
    });
  } catch (error) {
    console.error('Error completing water sort level:', error);
    res.status(500).json({ success: false, error: 'Failed to record level completion' });
  }
};

