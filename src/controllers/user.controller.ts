import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { storage } from '../config/firebase';

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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const gullakClaimsToday = await prisma.gameSession.count({
      where: {
        userId,
        status: 'completed',
        gameType: { not: 'spin' },
        endTime: { gte: startOfDay }
      }
    });

    res.status(200).json({
      user: {
        ...userProfile,
        gullakClaimsToday
      }
    });
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

    // Only query transactions from the last 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const transactions = await prisma.transaction.findMany({
      where: { 
        userId,
        createdAt: { gte: threeDaysAgo }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.transaction.count({ 
      where: { 
        userId,
        createdAt: { gte: threeDaysAgo }
      } 
    });

    res.status(200).json({
      success: true,
      transactions,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit))
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

    // Check for duplicate UPI ID across SikkaPlay accounts
    if (upiId && upiId.trim() !== '') {
      const normalizedUpi = upiId.trim();
      const duplicateUpi = await prisma.user.findFirst({
        where: {
          upiId: normalizedUpi,
          id: { not: userId }
        }
      });

      if (duplicateUpi) {
        res.status(400).json({ error: 'This UPI ID is already linked to another SikkaPlay account' });
        return;
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { upiId: upiId ? upiId.trim() : null }
    });

    res.status(200).json({ success: true, message: 'UPI ID updated successfully' });
  } catch (error) {
    console.error('Error updating UPI ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const recordAdImpression = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { adType, adNetwork, coinsAwarded, externalTxId } = req.body;

    console.log('[AD IMPRESSION RECEIVED] User:', userId, 'Type:', adType, 'Network:', adNetwork);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    if (!adType || !adNetwork) {
      res.status(400).json({ error: 'adType and adNetwork are required' });
      return;
    }

    const impression = await prisma.adImpression.create({
      data: {
        userId,
        adType,
        adNetwork,
        coinsAwarded: coinsAwarded || 0,
        externalTxId: externalTxId || null,
        verifiedByServer: false
      }
    });

    res.status(200).json({ success: true, impression });
  } catch (error) {
    console.error('Error recording ad impression:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateBio = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { bio } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (bio === undefined) {
      res.status(400).json({ error: 'Bio parameter is required' });
      return;
    }

    const cleanBio = bio ? bio.trim() : '';

    if (cleanBio.length > 100) {
      res.status(400).json({ error: 'Bio cannot exceed 100 characters' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { bio: cleanBio }
    });

    res.status(200).json({ success: true, bio: updatedUser.bio });
  } catch (error) {
    console.error('Error updating bio:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { imageBase64 } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 parameter is required' });
      return;
    }

    // Decode base64
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Delete old avatar from storage if exists
    if (user.avatarUrl && user.avatarUrl.includes('firebasestorage.googleapis.com')) {
      try {
        // Extract file path from url
        const decodedUrl = decodeURIComponent(user.avatarUrl);
        const matches = decodedUrl.match(/\/b\/[^\/]+\/o\/([^?]+)/);
        if (matches && matches[1]) {
          const oldFilePath = matches[1];
          await storage.bucket().file(oldFilePath).delete();
        }
      } catch (e) {
        console.error('Error deleting old avatar:', e);
      }
    }

    // Upload new avatar
    const timestamp = Date.now();
    const filePath = `profile_pictures/${userId}_${timestamp}.jpg`;
    const file = storage.bucket().file(filePath);

    await file.save(buffer, {
      metadata: { contentType: 'image/jpeg' },
      public: true,
    });

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(filePath)}?alt=media`;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: publicUrl }
    });

    res.status(200).json({ success: true, avatarUrl: updatedUser.avatarUrl });
  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
