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

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
