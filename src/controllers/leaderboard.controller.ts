import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import NodeCache from 'node-cache';

// Create a cache instance with a default TTL of 10 minutes (600 seconds)
const cache = new NodeCache({ stdTTL: 600 });

export const getLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    // 1. Try to get cached leaderboard list (top 20 users)
    let topUsers = cache.get<any[]>('top_users');
    if (!topUsers) {
      topUsers = await prisma.user.findMany({
        orderBy: { totalEarned: 'desc' },
        take: 20,
        select: {
          id: true,
          name: true,
          totalEarned: true,
          phoneNumber: true,
        },
      });
      cache.set('top_users', topUsers);
    }

    // 2. Fetch current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        totalEarned: true,
        phoneNumber: true,
      },
    });

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // 3. Determine current user's rank (cached per-user for 10 minutes)
    const rankCacheKey = `rank_${userId}`;
    let userRank = cache.get<number>(rankCacheKey);
    if (userRank === undefined) {
      const higherEarnersCount = await prisma.user.count({
        where: {
          totalEarned: {
            gt: currentUser.totalEarned,
          },
        },
      });
      userRank = higherEarnersCount + 1;
      cache.set(rankCacheKey, userRank);
    }

    res.status(200).json({
      success: true,
      leaderboard: topUsers,
      currentUserRank: {
        rank: userRank,
        user: currentUser,
      },
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
