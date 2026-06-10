import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

const fetchUsersWithStats = async (codes: string[]) => {
  if (codes.length === 0) return [];
  
  const users = await prisma.user.findMany({
    where: { referredBy: { in: codes } },
    select: { id: true, name: true, createdAt: true, referralCode: true, totalEarned: true },
  });

  if (users.length === 0) return [];

  const userIds = users.map(u => u.id);

  // Group by userId and sum minutes directly in database
  const playtimes = await prisma.dailyUsage.groupBy({
    by: ['userId'],
    _sum: {
      reelsMinutes: true,
      gamesMinutes: true,
    },
    where: {
      userId: { in: userIds }
    }
  });

  const playtimeMap = new Map<string, number>();
  for (const pt of playtimes) {
    const total = (pt._sum.reelsMinutes ?? 0) + (pt._sum.gamesMinutes ?? 0);
    playtimeMap.set(pt.userId, total);
  }

  return users.map(u => ({
    id: u.id,
    name: u.name,
    createdAt: u.createdAt,
    referralCode: u.referralCode,
    totalEarned: u.totalEarned,
    playtime: playtimeMap.get(u.id) ?? 0,
  }));
};

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

    // Personal Playtime aggregate directly in database
    const playtimeAggregate = await prisma.dailyUsage.aggregate({
      where: { userId },
      _sum: {
        reelsMinutes: true,
        gamesMinutes: true,
      }
    });
    const personalPlaytime = (playtimeAggregate._sum.reelsMinutes ?? 0) + (playtimeAggregate._sum.gamesMinutes ?? 0);

    // Level 1: Users referred directly by this user
    const level1 = await fetchUsersWithStats([user.referralCode]);
    const level1Codes = level1.map(u => u.referralCode);

    // Level 2: Users referred by Level 1 users
    const level2 = await fetchUsersWithStats(level1Codes);
    const level2Codes = level2.map(u => u.referralCode);

    // Level 3: Users referred by Level 2 users
    const level3 = await fetchUsersWithStats(level2Codes);

    res.status(200).json({
      success: true,
      referralBalance: user.referralBalance,
      personalPlaytime,
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

