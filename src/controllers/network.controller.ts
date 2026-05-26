import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

export const getMyNetwork = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, referralBalance: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Level 1: Users referred directly by this user
    const level1 = await prisma.user.findMany({
      where: { referredBy: user.referralCode },
      select: { id: true, name: true, createdAt: true, referralCode: true },
    });
    const level1Codes = level1.map(u => u.referralCode);

    // Level 2: Users referred by Level 1 users
    let level2: any[] = [];
    let level2Codes: string[] = [];
    if (level1Codes.length > 0) {
      level2 = await prisma.user.findMany({
        where: { referredBy: { in: level1Codes } },
        select: { id: true, name: true, createdAt: true, referralCode: true },
      });
      level2Codes = level2.map(u => u.referralCode);
    }

    // Level 3: Users referred by Level 2 users
    let level3: any[] = [];
    if (level2Codes.length > 0) {
      level3 = await prisma.user.findMany({
        where: { referredBy: { in: level2Codes } },
        select: { id: true, name: true, createdAt: true, referralCode: true },
      });
    }

    res.status(200).json({
      success: true,
      referralBalance: user.referralBalance,
      network: {
        level1,
        level2,
        level3,
        totalTeam: level1.length + level2.length + level3.length,
      }
    });
  } catch (error) {
    console.error('Error fetching network:', error);
    res.status(500).json({ error: 'Internal server error while fetching network' });
  }
};
