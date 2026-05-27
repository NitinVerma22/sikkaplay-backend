import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20, // Limit to 20 recent transactions
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Exclude passwordHash from response
    const { passwordHash, ...userProfile } = user;

    res.status(200).json({ user: userProfile });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateFcmToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { token } = req.body;

    if (!userId || !token) {
      res.status(400).json({ error: 'Missing user ID or token' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating FCM token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.transaction.count({ where: { userId } });

    res.status(200).json({
      success: true,
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUpi = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { upiId } = req.body;

    if (!userId || upiId === undefined) {
      res.status(400).json({ error: 'Missing user ID or UPI ID' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { upiId }
    });

    res.status(200).json({ success: true, message: 'UPI ID updated successfully' });
  } catch (error) {
    console.error('Error updating UPI ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
