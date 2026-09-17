import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

export const incrementGullak = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Assuming we stop at 9 and wait for claim to reset
    if (user.win600UnlockedGullaks >= 9) {
      return res.json({ success: true, count: user.win600UnlockedGullaks });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { win600UnlockedGullaks: { increment: 1 } },
    });

    return res.json({ success: true, count: updatedUser.win600UnlockedGullaks });
  } catch (error) {
    console.error('Error incrementing gullak:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const claimGullakReward = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.win600UnlockedGullaks < 9) {
      return res.status(400).json({ error: 'Not enough gullaks unlocked' });
    }

    // Reset gullaks to 0 and give 600 coins
    const rewardAmount = 150;
    const updatedUser = await prisma.$transaction(async (tx: any) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: {
          win600UnlockedGullaks: 0,
          balance: { increment: rewardAmount },
          totalEarned: { increment: rewardAmount },
        }
      });
      await tx.transaction.create({
        data: {
          userId,
          amount: rewardAmount,
          type: 'earning',
          status: 'success',
          description: 'Claimed Win 600 Coins Gullak Reward',
        }
      });
      return u;
    });

    return res.json({ success: true, balance: updatedUser.balance });
  } catch (error) {
    console.error('Error claiming gullak reward:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
