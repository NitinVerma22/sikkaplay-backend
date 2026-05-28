import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

export const getWalletStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday as start of week
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
      const isReferral = tx.type === 'referral_level_income';
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
    const { amount, upiId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid withdrawal amount' });
      return;
    }

    // 1. Fetch user and app configuration
    const [user, config] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.appConfig.findFirst()
    ]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const minLimit = config?.minWithdrawalLimit || 1000;
    if (amount < minLimit) {
      res.status(400).json({ error: `Minimum withdrawal amount is ${minLimit} coins` });
      return;
    }

    if (user.balance < amount) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    const targetUpi = upiId || user.upiId;
    if (!targetUpi) {
      res.status(400).json({ error: 'UPI ID is required for withdrawal' });
      return;
    }

    // 2. Process withdrawal transaction and deduct balance
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } }
      }),
      prisma.transaction.create({
        data: {
          userId,
          amount: -amount, // Stored as a negative amount for withdrawals
          type: 'withdrawal',
          status: 'pending',
          description: `Withdrawal request to UPI: ${targetUpi}`
        }
      })
    ]);

    res.status(200).json({ success: true, message: 'Withdrawal request submitted successfully' });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
