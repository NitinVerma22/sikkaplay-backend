import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getISTDateString, getStartOfTodayIST } from '../utils/date.utils';
import { getCachedAppConfig } from '../services/config.service';

// Social Tasks In-Memory Cache
let cachedSocialTasks: any[] | null = null;
let socialTasksCacheExpiry = 0;

export const getCachedSocialTasks = async () => {
  const now = Date.now();
  if (cachedSocialTasks && now < socialTasksCacheExpiry) {
    return cachedSocialTasks;
  }
  const tasks = await prisma.socialTask.findMany({
    orderBy: { createdAt: 'asc' }
  });
  cachedSocialTasks = tasks;
  socialTasksCacheExpiry = now + 10 * 60 * 1000; // 10 minutes cache duration
  return tasks;
};

export const invalidateSocialTasksCache = () => {
  cachedSocialTasks = null;
  socialTasksCacheExpiry = 0;
  console.log('[CACHE] SocialTasks cache invalidated.');
};

export const getHomeState = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        balance: true,
        totalEarned: true,
        referralBalance: true,
        withdrawalAmount: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Top 10 transactions for recent rewards
    const topTransactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        description: true,
        amount: true,
        createdAt: true,
        status: true,
        type: true
      }
    });

    const today = new Date();
    const todayStr = getISTDateString(today);
    const startOfToday = getStartOfTodayIST(today);

    // Find daily usage for today
    const usageToday = await prisma.dailyUsage.findUnique({
      where: {
        userId_dateStr: {
          userId,
          dateStr: todayStr,
        }
      },
      select: {
        gamesMinutes: true
      }
    });

    // Determine streak claim status for today
    const streakToday = await prisma.transaction.findFirst({
      where: {
        userId,
        type: 'daily_streak',
        createdAt: { gte: startOfToday }
      },
      select: {
        id: true
      }
    });
    const hasClaimedToday = !!streakToday;

    // Fetch all daily streak transactions to calculate accurate streak count
    const allStreaks = await prisma.transaction.findMany({
      where: { userId, type: 'daily_streak' },
      orderBy: { createdAt: 'desc' },
    });

    let currentStreak = 0;
    let checkDate = new Date(today.getTime()); // Start from today copy
    if (!hasClaimedToday) {
      // If not claimed today, the streak is maintained if claimed yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < allStreaks.length; i++) {
      const streakDateStr = getISTDateString(allStreaks[i].createdAt);
      const targetDateStr = getISTDateString(checkDate);
      
      if (streakDateStr === targetDateStr) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (streakDateStr < targetDateStr) {
        // Streak broken
        break;
      }
    }

    // Allow streak to continue past 28 without looping back to 0

    // New Daily Streak Resume Detection logic
    let skippedDays = 0;
    let streakBeforeSkip = 0;
    let canStreakResume = false;
    let resumeCost = 0;

    if (allStreaks.length > 0) {
      const lastClaimDateStr = getISTDateString(allStreaks[0].createdAt);
      const todayStr = getISTDateString(today);
      const yesterdayStr = getISTDateString(new Date(today.getTime() - 24 * 60 * 60 * 1000));

      if (lastClaimDateStr !== todayStr && lastClaimDateStr !== yesterdayStr) {
        const parseISTDate = (dateStr: string): Date => {
          return new Date(`${dateStr}T00:00:00.000Z`);
        };
        const diffTime = Math.abs(parseISTDate(todayStr).getTime() - parseISTDate(lastClaimDateStr).getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        skippedDays = diffDays - 1;

        if (skippedDays > 0) {
          canStreakResume = true;
          resumeCost = skippedDays * 15;

          // Calculate streak before the skip
          let tempCheckDate = new Date(allStreaks[0].createdAt);
          for (let i = 0; i < allStreaks.length; i++) {
            const streakDateStr = getISTDateString(allStreaks[i].createdAt);
            const targetDateStr = getISTDateString(tempCheckDate);
            if (streakDateStr === targetDateStr) {
              streakBeforeSkip++;
              tempCheckDate.setDate(tempCheckDate.getDate() - 1);
            } else if (streakDateStr < targetDateStr) {
              break;
            }
          }
          // No modulo reset needed for streak before skip
        }
      }
    }
    
    // Today's claim is already processed inside the allStreaks loop since allStreaks contains today's transaction if claimed today.

    // Reconstruct recent rewards for home screen
    const recentRewards = topTransactions.map(t => ({
      title: t.description,
      rewardAmount: t.amount,
      timeAgo: t.createdAt.toISOString(),
      isClaim: t.status === 'success',
      status: t.status,
      type: t.type,
    }));

    // Find claimed milestones for today from today's transactions
    const todaysTransactions = await prisma.transaction.findMany({
      where: { userId, createdAt: { gte: startOfToday } },
      select: {
        description: true
      }
    });

    const playEarnClaimedMilestones: number[] = [];
    
    todaysTransactions.forEach(t => {

      const matchPlay = t.description.match(/Played.*?(\d+)\s*mins/i);
      if (matchPlay) playEarnClaimedMilestones.push(parseInt(matchPlay[1]));
    });

    // Fetch all claimed social task IDs
    const claimedSocialTasks = await prisma.socialTaskClaim.findMany({
      where: { userId },
      select: { socialTaskId: true }
    });
    const completedSocialTasks = claimedSocialTasks.map(c => c.socialTaskId);

    // Fetch all active social tasks
    const activeSocialTasks = await getCachedSocialTasks();

    const socialTasks = activeSocialTasks.map(task => ({
      id: task.id,
      platform: task.platform,
      title: task.title,
      link: task.link,
      coinsReward: task.coinsReward,
      isCompleted: completedSocialTasks.includes(task.id)
    }));

    // 1. Visit All Links calculations
    const totalLinks = await prisma.visitEarnLink.count();
    const visitedClaimsToday = await prisma.visitEarnClaim.findMany({
      where: {
        userId,
        claimedAt: { gte: startOfToday }
      },
      select: { linkId: true }
    });
    const uniqueVisitedLinks = new Set(visitedClaimsToday.map(c => c.linkId));
    const hasVisitedAllLinksToday = totalLinks > 0 && uniqueVisitedLinks.size >= totalLinks;

    // 2. Claim Daily Code calculations
    const dailyCodeClaimsToday = await prisma.dailyCodeClaim.count({
      where: {
        userId,
        createdAt: { gte: startOfToday }
      }
    });
    const hasClaimedDailyCodeToday = dailyCodeClaimsToday > 0;

    // 3. Check if task rewards were claimed today
    const dailyCodeTaskClaimed = todaysTransactions.some(t => t.description === 'Daily Task: Claimed Daily Code');
    const visitAllTaskClaimed = todaysTransactions.some(t => t.description === 'Daily Task: Visited All Links');

    res.status(200).json({
      success: true,
      balance: user.balance,
      totalEarning: user.totalEarned,
      referralEarning: user.referralBalance,
      withdrawalAmount: user.withdrawalAmount,
      streakCount: currentStreak,
      hasClaimedToday,
      recentRewards,
      gamesMinutesPlayed: usageToday?.gamesMinutes || 0,
      playEarnClaimedMilestones,
      completedSocialTasks,
      socialTasks,
      dailyCodeTaskCompleted: hasClaimedDailyCodeToday,
      dailyCodeTaskClaimed,
      visitAllTaskCompleted: hasVisitedAllLinksToday,
      visitAllTaskClaimed,
      visitAllTaskTotalLinks: totalLinks,
      visitAllTaskVisitedLinks: uniqueVisitedLinks.size,
      canStreakResume,
      streakResumeCost: resumeCost,
      skippedDaysCount: skippedDays,
      streakBeforeSkip
    });

  } catch (error) {
    console.error('Error fetching home state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
