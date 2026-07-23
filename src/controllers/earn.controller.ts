import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getISTDateString, getStartOfTodayIST } from '../utils/date.utils';

/**
 * Claim Daily Streak Reward
 * Server calculates user's active streak day, checks double-claiming, and awards preset coins.
 */
export const claimDailyStreak = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const today = new Date();
    const startOfToday = getStartOfTodayIST(today);

    // Verify user has not claimed today
    const streakToday = await prisma.transaction.findFirst({
      where: {
        userId,
        type: 'daily_streak',
        createdAt: { gte: startOfToday }
      }
    });

    if (streakToday) {
      res.status(400).json({ error: 'Daily streak already claimed today' });
      return;
    }

    // Retrieve user's current streak count
    const allStreaks = await prisma.transaction.findMany({
      where: { userId, type: 'daily_streak' },
      orderBy: { createdAt: 'desc' },
    });

    let currentStreak = 0;
    const checkDate = new Date(today.getTime());
    // Since hasClaimedToday is false, check starting from yesterday
    checkDate.setDate(checkDate.getDate() - 1);

    for (let i = 0; i < allStreaks.length; i++) {
      const streakDateStr = getISTDateString(allStreaks[i].createdAt);
      const targetDateStr = getISTDateString(checkDate);
      
      if (streakDateStr === targetDateStr) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (streakDateStr < targetDateStr) {
        break;
      }
    }

    const activeDay = (currentStreak % 28) + 1;

    // Calculate coins for the day
    const getCoinsForDay = (day: number): number => {
      if (day === 7) return 500;
      if (day === 14) return 1000;
      if (day === 21) return 1500;
      if (day === 28) return 2000;
      return day * 10;
    };

    const coinsReward = getCoinsForDay(activeDay);

    const result = await prisma.$transaction(async (tx) => {
      // Lock user row
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsReward },
          totalEarned: { increment: coinsReward },
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: coinsReward,
          type: 'daily_streak',
          status: 'success',
          description: `Daily Streak Day ${activeDay} Reward`
        }
      });

      return { user: updatedUser, transaction };
    });

    res.status(200).json({
      success: true,
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming daily streak:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Claim Social Join Task Reward
 * Validates platform task, checks if completed, and awards fixed 55 coins.
 */
export const claimSocialTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { platform } = req.body; // 'telegram', 'whatsapp', 'group'

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!platform || !['telegram', 'whatsapp', 'group'].includes(platform)) {
      res.status(400).json({ error: 'Invalid platform specified' });
      return;
    }

    const config = await prisma.appConfig.findFirst();
    let taskUrl = '';
    if (platform === 'telegram') taskUrl = config?.telegramLink || 'https://t.me/sikkaplay';
    else if (platform === 'whatsapp') taskUrl = config?.whatsappLink || 'https://whatsapp.com/channel/sikkaplay';
    else if (platform === 'group') taskUrl = config?.groupLink || 'https://t.me/sikkaplay_group';

    const description = `Joined ${platform}: ${taskUrl}`;

    // Verify task not already completed
    const existing = await prisma.transaction.findFirst({
      where: {
        userId,
        type: 'social_task',
        description
      }
    });

    if (existing) {
      res.status(400).json({ error: 'Social task already claimed' });
      return;
    }

    const coinsReward = 55; // Fixed social task reward

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsReward },
          totalEarned: { increment: coinsReward },
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: coinsReward,
          type: 'social_task',
          status: 'success',
          description
        }
      });

      return { user: updatedUser, transaction };
    });

    res.status(200).json({
      success: true,
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming social task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Claim Survey Reward (mock surveys and webviews)
 * Validates survey provider, caps survey earnings daily.
 */
export const claimSurvey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { title, provider } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!title || !provider) {
      res.status(400).json({ error: 'Title and provider are required' });
      return;
    }

    // Server determines coins based on provider/title to prevent client manipulation
    let coinsReward = 100; // default mock survey reward
    if (provider.toLowerCase().includes('cpx')) {
      coinsReward = 500;
    } else if (title.includes('Premium Survey')) {
      coinsReward = 250;
    }

    // Daily cap of 2000 coins for survey claims to prevent scripts
    const today = new Date();
    const startOfToday = getStartOfTodayIST(today);

    const surveyTransactionsToday = await prisma.transaction.findMany({
      where: {
        userId,
        type: 'survey',
        createdAt: { gte: startOfToday }
      }
    });

    const totalSurveyEarnedToday = surveyTransactionsToday.reduce((sum, tx) => sum + tx.amount, 0);
    if (totalSurveyEarnedToday + coinsReward > 2000) {
      res.status(400).json({ error: 'Daily survey reward limit (2000 coins) exceeded' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsReward },
          totalEarned: { increment: coinsReward },
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: coinsReward,
          type: 'survey',
          status: 'success',
          description: title || `${provider} Survey Completion`
        }
      });

      return { user: updatedUser, transaction };
    });

    res.status(200).json({
      success: true,
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming survey reward:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Claim App Install Reward (mock downloads)
 * Server-authoritative mapping of valid apps and coin rewards.
 */
export const claimAppInstall = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { offerId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Offers configuration map matching app_install_screen.dart
    const OFFERS: Record<string, { title: string, rewardAmount: number }> = {
      binance: { title: 'Binance Crypto Exchange', rewardAmount: 350 },
      phonepe: { title: 'PhonePe: UPI payments', rewardAmount: 180 },
      telegram: { title: 'Telegram Messenger', rewardAmount: 60 },
      gpay: { title: 'Google Pay payments', rewardAmount: 220 },
      whatsapp_biz: { title: 'WhatsApp Business', rewardAmount: 80 }
    };

    const offer = OFFERS[offerId];
    if (!offer) {
      res.status(400).json({ error: 'Invalid offer ID' });
      return;
    }

    const description = `Installed & verified ${offer.title}`;

    // Verify user hasn't already claimed this app install
    const existing = await prisma.transaction.findFirst({
      where: {
        userId,
        type: 'app_install',
        description
      }
    });

    if (existing) {
      res.status(400).json({ error: 'App offer already completed' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: offer.rewardAmount },
          totalEarned: { increment: offer.rewardAmount },
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: offer.rewardAmount,
          type: 'app_install',
          status: 'success',
          description
        }
      });

      return { user: updatedUser, transaction };
    });

    res.status(200).json({
      success: true,
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming app install reward:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Claim Milestones (Watch Reels / Play Games duration, daily code task, visit links task)
 * Server verifies that the client has met the duration threshold / task completion today.
 */
export const claimMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { type, minutes } = req.body; // type: 'watch' | 'play' | 'daily_code_task' | 'visit_all_task'

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!type || !['play', 'daily_code_task', 'visit_all_task'].includes(type)) {
      res.status(400).json({ error: 'Invalid type specified' });
      return;
    }

    const config = await prisma.appConfig.findFirst();
    if (!config) {
      res.status(500).json({ error: 'App configuration not found' });
      return;
    }

    let coinsReward = 0;
    let description = '';
    let dbTxType = 'earning';

    const todayStr = getISTDateString();
    const startOfToday = getStartOfTodayIST();

    if (type === 'play') {
      if (typeof minutes !== 'number') {
        res.status(400).json({ error: 'Minutes is required for play milestones' });
        return;
      }
      if (minutes === config.playM1Mins) coinsReward = config.playM1Coins;
      else if (minutes === config.playM2Mins) coinsReward = config.playM2Coins;
      else if (minutes === config.playM3Mins) coinsReward = config.playM3Coins;
      else {
        res.status(400).json({ error: 'Invalid play milestone minutes' });
        return;
      }
      description = `Played Games for ${minutes} mins`;
      dbTxType = 'earning';
    } else if (type === 'daily_code_task') {
      coinsReward = config.dailyCodeTaskCoins;
      description = 'Daily Task: Claimed Daily Code';
      dbTxType = 'earning';

      // Verify server side
      const claimsToday = await prisma.dailyCodeClaim.count({
        where: {
          userId,
          createdAt: { gte: startOfToday }
        }
      });
      if (claimsToday === 0) {
        res.status(400).json({ error: 'You must claim a Daily Code first today' });
        return;
      }
    } else if (type === 'visit_all_task') {
      coinsReward = config.visitAllTaskCoins;
      description = 'Daily Task: Visited All Links';
      dbTxType = 'earning';

      // Verify server side
      const totalLinks = await prisma.visitEarnLink.count();
      const visitedClaimsToday = await prisma.visitEarnClaim.findMany({
        where: {
          userId,
          claimedAt: { gte: startOfToday }
        },
        select: { linkId: true }
      });
      const uniqueVisitedLinks = new Set(visitedClaimsToday.map(c => c.linkId));

      if (totalLinks === 0 || uniqueVisitedLinks.size < totalLinks) {
        res.status(400).json({ error: 'You must visit all links first today' });
        return;
      }
    }

    // For duration-based play milestones, verify the actual logged minutes today
    if (type === 'play') {
      const usage = await prisma.dailyUsage.findUnique({
        where: {
          userId_dateStr: { userId, dateStr: todayStr }
        }
      });

      const actualMinutes = usage?.gamesMinutes || 0;
      const requiredMinutes = minutes as number;
      if (actualMinutes < requiredMinutes) {
        res.status(400).json({
          error: `Incomplete milestone. You have only ${actualMinutes}/${requiredMinutes} mins logged today.`
        });
        return;
      }
    }

    // Verify user has not already claimed this milestone today
    const existing = await prisma.transaction.findFirst({
      where: {
        userId,
        type: dbTxType,
        description,
        createdAt: { gte: startOfToday }
      }
    });

    if (existing) {
      res.status(400).json({ error: 'Milestone already claimed today' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsReward },
          totalEarned: { increment: coinsReward }
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: coinsReward,
          type: dbTxType,
          status: 'success',
          description
        }
      });

      return { user: updatedUser, transaction };
    });

    res.status(200).json({
      success: true,
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming milestone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const resumeDailyStreak = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const today = new Date();
    const todayStr = getISTDateString(today);

    // Fetch all daily streak transactions
    const allStreaks = await prisma.transaction.findMany({
      where: { userId, type: 'daily_streak', status: 'success' },
      orderBy: { createdAt: 'desc' },
    });

    if (allStreaks.length === 0) {
      res.status(400).json({ error: 'No existing streak to resume' });
      return;
    }

    const lastClaimDateStr = getISTDateString(allStreaks[0].createdAt);
    const yesterdayStr = getISTDateString(new Date(today.getTime() - 24 * 60 * 60 * 1000));

    if (lastClaimDateStr === todayStr || lastClaimDateStr === yesterdayStr) {
      res.status(400).json({ error: 'Streak is already active, no need to resume' });
      return;
    }

    const parseISTDate = (dateStr: string): Date => {
      return new Date(`${dateStr}T00:00:00.000Z`);
    };

    const diffTime = Math.abs(parseISTDate(todayStr).getTime() - parseISTDate(lastClaimDateStr).getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const skippedDays = diffDays - 1;

    if (skippedDays <= 0) {
      res.status(400).json({ error: 'No skipped days found' });
      return;
    }

    const cost = skippedDays * 15;

    // Check user balance
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.balance < cost) {
      res.status(400).json({ error: `Insufficient balance. You need ${cost} coins to resume.` });
      return;
    }

    // Perform transaction to deduct coins and insert dummy daily_streak rows
    const result = await prisma.$transaction(async (tx) => {
      // Lock user row
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);

      // Deduct cost
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { decrement: cost }
        }
      });

      // Create spend transaction for resume fee
      const resumeFeeTx = await tx.transaction.create({
        data: {
          userId,
          amount: -cost,
          type: 'spend',
          status: 'success',
          description: `Daily Streak Resume Fee (${skippedDays} days)`
        }
      });

      // Insert restored daily_streak records for skipped days
      const lastClaimDate = new Date(allStreaks[0].createdAt);
      for (let d = 1; d <= skippedDays; d++) {
        const skippedDate = new Date(lastClaimDate.getTime());
        skippedDate.setDate(skippedDate.getDate() + d);

        // Position it at 12:00:00 PM IST
        const skippedDateIST = getStartOfTodayIST(skippedDate);
        skippedDateIST.setHours(skippedDateIST.getHours() + 12);

        await tx.transaction.create({
          data: {
            userId,
            amount: 0,
            type: 'daily_streak',
            status: 'success',
            description: `Daily Streak Restored (Paid)`,
            createdAt: skippedDateIST
          }
        });
      }

      return { user: updatedUser, transaction: resumeFeeTx };
    });

    res.status(200).json({
      success: true,
      message: `Streak successfully resumed! Charged ${cost} coins.`,
      balance: result.user.balance,
      transaction: result.transaction
    });

  } catch (error) {
    console.error('Error resuming daily streak:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
