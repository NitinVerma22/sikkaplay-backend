import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getStartOfTodayIST, getStartOfYesterdayIST, getStartOfWeekIST, getStartOfMonthIST } from '../utils/date.utils';
import { getCachedAppConfig } from '../services/config.service';
import { logAdminAction } from '../services/audit.service';

export const getWalletStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const startOfToday = getStartOfTodayIST(now);
    const startOfYesterday = getStartOfYesterdayIST(now);
    const startOfWeek = getStartOfWeekIST(now);
    const startOfMonth = getStartOfMonthIST(now);

    // Fetch all successful earning transactions for the user
    // type in ['earning', 'referral_level_income', 'bonus', 'daily_streak', 'social_task']
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        status: 'success',
        type: {
          not: 'withdrawal' // We only want earnings
        }
      },
      select: {
        amount: true,
        createdAt: true,
        type: true
      }
    });

    const stats = {
      self: { today: 0, yesterday: 0, weekly: 0, monthly: 0, total: 0 },
      referral: { today: 0, yesterday: 0, weekly: 0, monthly: 0, total: 0 }
    };

    for (const tx of transactions) {
      const isReferral = tx.type === 'referral_level_income' || tx.type === 'network_income';
      const target = isReferral ? stats.referral : stats.self;
      
      target.total += tx.amount;
      
      if (tx.createdAt >= startOfToday) {
        target.today += tx.amount;
      } else if (tx.createdAt >= startOfYesterday) {
        target.yesterday += tx.amount;
      }
      
      if (tx.createdAt >= startOfWeek) {
        target.weekly += tx.amount;
      }
      
      if (tx.createdAt >= startOfMonth) {
        target.monthly += tx.amount;
      }
    }

    // Fetch sum of pending withdrawals
    const pendingWithdrawalAmount = await prisma.transaction.aggregate({
      where: {
        userId,
        type: 'withdrawal',
        status: 'pending'
      },
      _sum: {
        amount: true
      }
    });

    const pendingWithdrawal = Math.abs(pendingWithdrawalAmount._sum.amount || 0);

    res.status(200).json({
      success: true,
      stats: {
        ...stats,
        pendingWithdrawal
      }
    });
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requestWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    let { amount, upiId, earningType, withdrawalOptionId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let withdrawalOption = null;
    if (withdrawalOptionId) {
      withdrawalOption = await prisma.withdrawalOption.findUnique({
        where: { id: withdrawalOptionId }
      });
      if (!withdrawalOption || !withdrawalOption.enabled) {
        res.status(400).json({ error: 'Selected withdrawal package is invalid or disabled' });
        return;
      }
      amount = withdrawalOption.coins;
      earningType = withdrawalOption.earningType;
    }

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid withdrawal amount' });
      return;
    }

    // 1. Fetch user and app configuration
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const config = await getCachedAppConfig();

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // --- WITHDRAWAL FRAUD ENGINE CHECKS ---
    
    // Check A: Playtime check (Max 18 hours / 1080 minutes combined playtime in last 7 days)
    const recentUsages = await prisma.dailyUsage.findMany({
      where: { userId },
      orderBy: { dateStr: 'desc' },
      take: 7
    });
    
    const hasAbnormalPlaytime = recentUsages.some(
      (u) => u.gamesMinutes > 1080
    );
    
    if (hasAbnormalPlaytime) {
      console.warn(`[FRAUD ENGINE] Auto-blocking user ${userId} due to abnormal playtime (>18h/day).`);
      await prisma.user.update({
        where: { id: userId },
        data: { isBlocked: true }
      });
      
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      await logAdminAction(
        'system',
        'Fraud Engine',
        'AUTO_FREEZE_USER',
        { userId, reason: 'Abnormal playtime detected (>18 hours in a single day)', recentUsages },
        ip
      );
      
      res.status(403).json({ error: 'Your account has been frozen due to suspicious activity. Please contact support.' });
      return;
    }

    // Check B: Excessive Self Earnings (>10,000 coins in last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEarnings = await prisma.transaction.findMany({
      where: {
        userId,
        createdAt: { gte: oneDayAgo },
        status: 'success',
        type: {
          in: ['earning', 'bonus', 'daily_streak', 'social_task']
        }
      }
    });
    
    const totalRecentSelfEarnings = recentEarnings.reduce((sum, tx) => sum + tx.amount, 0);
    if (totalRecentSelfEarnings > 10000) {
      console.warn(`[FRAUD ENGINE] Auto-blocking user ${userId} due to excessive self-earnings (${totalRecentSelfEarnings} coins in 24h).`);
      await prisma.user.update({
        where: { id: userId },
        data: { isBlocked: true }
      });
      
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      await logAdminAction(
        'system',
        'Fraud Engine',
        'AUTO_FREEZE_USER',
        { userId, reason: `Excessive non-referral earnings detected (${totalRecentSelfEarnings} coins in 24h)`, totalRecentSelfEarnings },
        ip
      );
      
      res.status(403).json({ error: 'Your account has been frozen due to suspicious activity. Please contact support.' });
      return;
    }

    // Check C: Duplicate UPI ID across multiple accounts
    const targetUpi = upiId || user.upiId;
    if (targetUpi) {
      // Check if another user profile has the same UPI ID
      const upiInUse = await prisma.user.findFirst({
        where: {
          upiId: targetUpi,
          id: { not: userId }
        }
      });
      
      // Check if another user has withdrawn to this same UPI ID in success or pending states
      const upiInTx = await prisma.transaction.findFirst({
        where: {
          description: { contains: targetUpi },
          userId: { not: userId },
          status: { in: ['pending', 'success'] }
        }
      });
      
      if (upiInUse || upiInTx) {
        console.warn(`[FRAUD ENGINE] Auto-blocking user ${userId} due to duplicate UPI ID usage (${targetUpi}).`);
        await prisma.user.update({
          where: { id: userId },
          data: { isBlocked: true }
        });
        
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
        await logAdminAction(
          'system',
          'Fraud Engine',
          'AUTO_FREEZE_USER',
          {
            userId,
            reason: `Duplicate UPI ID detected: ${targetUpi}`,
            duplicateWithUserId: upiInUse?.id || upiInTx?.userId
          },
          ip
        );
        
        res.status(403).json({ error: 'Your account has been frozen due to suspicious activity. Please contact support.' });
        return;
      }
    }

    const minLimit = config?.minWithdrawalLimit || 1000;
    if (amount < minLimit) {
      res.status(400).json({ error: `Minimum withdrawal amount is ${minLimit} coins` });
      return;
    }

    const targetEarningType = earningType === 'referral' ? 'referral' : 'self';

    if (targetEarningType === 'referral') {
      if (user.referralBalance < amount) {
        res.status(400).json({ error: 'Insufficient referral balance' });
        return;
      }

      // Check referral withdrawal eligibility:
      const minPlaytime = config?.refWithdrawMinPlaytimeMins ?? 3000;
      const minReferrals = config?.refWithdrawMinReferrals ?? 2;

      // A. Play time check
      const usages = await prisma.dailyUsage.findMany({ where: { userId } });
      const personalPlaytime = usages.reduce((acc, u) => acc + u.gamesMinutes, 0);
      if (personalPlaytime < minPlaytime) {
        res.status(400).json({
          error: `You need at least ${(minPlaytime / 60).toFixed(1)} hours of playtime to withdraw referral earnings. You currently have ${(personalPlaytime / 60).toFixed(1)} hours.`
        });
        return;
      }

      // B. Active referrals check
      const activeReferralsCount = await prisma.user.count({
        where: { referredBy: user.referralCode }
      });
      if (activeReferralsCount < minReferrals) {
        res.status(400).json({
          error: `You need at least ${minReferrals} active referrals to withdraw referral earnings. You currently have ${activeReferralsCount}.`
        });
        return;
      }
    } else {
      if (user.balance < amount) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }
    }

    // targetUpi is already defined and checked above
    if (!targetUpi) {
      res.status(400).json({ error: 'UPI ID is required for withdrawal' });
      return;
    }

    // 2. Process withdrawal transaction inside an interactive transaction with FOR UPDATE locking
    await prisma.$transaction(async (tx) => {
      // Lock user row and fetch latest balance
      const users = await tx.$queryRawUnsafe<any[]>(
        'SELECT balance, "referralBalance" FROM "User" WHERE id = $1 FOR UPDATE',
        userId
      );

      if (!users || users.length === 0) {
        throw new Error('User not found');
      }

      const latestUser = users[0];

      if (withdrawalOptionId) {
        await tx.withdrawalOption.update({
          where: { id: withdrawalOptionId },
          data: { claimCount: { increment: 1 } }
        });
      }

      if (targetEarningType === 'referral') {
        if (latestUser.referralBalance < amount) {
          throw new Error('Insufficient referral balance');
        }

        await tx.user.update({
          where: { id: userId },
          data: { referralBalance: { decrement: amount } }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: -amount,
            type: 'withdrawal',
            status: 'pending',
            description: `Withdrawal request to UPI: ${targetUpi} (Referral Earning)`,
            withdrawalOptionId: withdrawalOptionId || null
          }
        });
      } else {
        if (latestUser.balance < amount) {
          throw new Error('Insufficient balance');
        }

        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: amount } }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: -amount,
            type: 'withdrawal',
            status: 'pending',
            description: `Withdrawal request to UPI: ${targetUpi} (Self Earning)`,
            withdrawalOptionId: withdrawalOptionId || null
          }
        });
      }
    });

    res.status(200).json({ success: true, message: 'Withdrawal request submitted successfully' });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getWithdrawalOptions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const options = await prisma.withdrawalOption.findMany({
      where: { enabled: true },
      orderBy: { coins: 'asc' }
    });

    const config = await prisma.appConfig.findFirst();

    res.status(200).json({
      success: true,
      options,
      selfWithdrawalNotice: config?.selfWithdrawalNotice || '',
      referralWithdrawalNotice: config?.referralWithdrawalNotice || '',
      showWithdrawalPackages: config?.showWithdrawalPackages ?? true
    });
  } catch (error) {
    console.error('Error fetching withdrawal options:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawal options' });
  }
};
