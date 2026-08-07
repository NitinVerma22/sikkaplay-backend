"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLeaderboard = void 0;
const db_1 = require("../config/db");
const node_cache_1 = __importDefault(require("node-cache"));
// Create a cache instance with a default TTL of 10 minutes (600 seconds)
const cache = new node_cache_1.default({ stdTTL: 600 });
const getLeaderboard = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        // 1. Try to get cached leaderboard list (top 20 users)
        let topUsers = cache.get('top_users');
        if (!topUsers) {
            topUsers = await db_1.prisma.user.findMany({
                orderBy: { totalEarned: 'desc' },
                take: 20,
                select: {
                    id: true,
                    name: true,
                    totalEarned: true,
                    phoneNumber: true,
                    avatarUrl: true,
                    username: true,
                },
            });
            cache.set('top_users', topUsers);
        }
        // 2. Fetch current user
        const currentUser = await db_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                totalEarned: true,
                phoneNumber: true,
                avatarUrl: true,
                username: true,
            },
        });
        if (!currentUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // 3. Determine current user's rank (cached per-user for 10 minutes)
        const rankCacheKey = `rank_${userId}`;
        let userRank = cache.get(rankCacheKey);
        if (userRank === undefined) {
            const higherEarnersCount = await db_1.prisma.user.count({
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
    }
    catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getLeaderboard = getLeaderboard;
