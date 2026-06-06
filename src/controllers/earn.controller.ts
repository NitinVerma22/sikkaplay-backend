import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getStartOfTodayIST } from '../utils/date.utils';

export const claimReward = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { amount, type, description } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    if (typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    if (!type || typeof type !== 'string') {
      res.status(400).json({ error: 'Invalid reward type' });
      return;
    }

    // Prevent double claiming of daily streak
    if (type === 'daily_streak') {
      const startOfToday = getStartOfTodayIST();

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
    }

    // Execute within a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update User Balance & Total Earned
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: amount },
          totalEarned: { increment: amount },
        },
      });

      // 2. Create Transaction Record
      const newTransaction = await tx.transaction.create({
        data: {
          userId,
          amount,
          type, // 'earning', 'bonus', etc.
          status: 'success', // Auto success for simple tasks/rewards
          description: description || `Claimed ${amount} coins for ${type}`,
        },
      });

      return { user: updatedUser, transaction: newTransaction };
    });



    res.status(200).json({
      success: true,
      message: 'Reward claimed successfully',
      balance: result.user.balance,
      totalEarned: result.user.totalEarned,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Error claiming reward:', error);
    res.status(500).json({ error: 'Internal server error while claiming reward' });
  }
};
