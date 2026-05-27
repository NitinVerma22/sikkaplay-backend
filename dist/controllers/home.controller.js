"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeState = void 0;
const db_1 = require("../config/db");
const getHomeState = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Top 10 transactions for recent rewards
        const topTransactions = await db_1.prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const startOfToday = new Date(todayStr);
        // Find daily usage for today
        const usageToday = await db_1.prisma.dailyUsage.findUnique({
            where: {
                userId_dateStr: {
                    userId,
                    dateStr: todayStr,
                }
            }
        });
        // Determine streak claim status for today
        const streakToday = await db_1.prisma.transaction.findFirst({
            where: {
                userId,
                type: 'daily_streak',
                createdAt: { gte: startOfToday }
            }
        });
        const hasClaimedToday = !!streakToday;
        // Fetch all daily streak transactions to calculate accurate streak count
        const allStreaks = await db_1.prisma.transaction.findMany({
            where: { userId, type: 'daily_streak' },
            orderBy: { createdAt: 'desc' },
        });
        let currentStreak = 0;
        let checkDate = new Date(todayStr); // Start from today at 00:00:00
        if (!hasClaimedToday) {
            // If not claimed today, the streak is maintained if claimed yesterday
            checkDate.setDate(checkDate.getDate() - 1);
        }
        for (let i = 0; i < allStreaks.length; i++) {
            const streakDateStr = allStreaks[i].createdAt.toISOString().split('T')[0];
            const targetDateStr = checkDate.toISOString().split('T')[0];
            if (streakDateStr === targetDateStr) {
                currentStreak++;
                checkDate.setDate(checkDate.getDate() - 1);
            }
            else if (streakDateStr < targetDateStr) {
                // Streak broken
                break;
            }
        }
        // Add today's claim to streak if claimed today
        if (hasClaimedToday) {
            currentStreak++;
        }
        // Reconstruct recent rewards for home screen
        const recentRewards = topTransactions.map(t => ({
            title: t.description,
            rewardAmount: t.amount,
            timeAgo: t.createdAt.toISOString(),
            isClaim: t.status === 'success',
            status: t.status,
            type: t.type,
        }));
        // Find claimed milestones for today from today's transactions
        const todaysTransactions = await db_1.prisma.transaction.findMany({
            where: { userId, createdAt: { gte: startOfToday } }
        });
        const watchEarnClaimedMilestones = [];
        const playEarnClaimedMilestones = [];
        todaysTransactions.forEach(t => {
            const matchWatch = t.description.match(/Watched.*?(\d+)\s*mins/i);
            if (matchWatch)
                watchEarnClaimedMilestones.push(parseInt(matchWatch[1]));
            const matchPlay = t.description.match(/Played.*?(\d+)\s*mins/i);
            if (matchPlay)
                playEarnClaimedMilestones.push(parseInt(matchPlay[1]));
        });
        const completedSocialTasks = [];
        // Assuming social tasks are stored once, we need to check ALL transactions for this
        const allSocialTasks = await db_1.prisma.transaction.findMany({
            where: { userId, type: 'social_task' }
        });
        allSocialTasks.forEach(t => {
            const id = t.description.toLowerCase().split(' ').pop() || '';
            completedSocialTasks.push(id);
        });
        res.status(200).json({
            success: true,
            balance: user.balance,
            totalEarning: user.totalEarned,
            referralEarning: user.referralBalance,
            withdrawalAmount: user.withdrawalAmount,
            streakCount: Math.max(1, currentStreak),
            hasClaimedToday,
            recentRewards,
            reelsMinutesWatched: usageToday?.reelsMinutes || 0,
            gamesMinutesPlayed: usageToday?.gamesMinutes || 0,
            watchEarnClaimedMilestones,
            playEarnClaimedMilestones,
            completedSocialTasks
        });
    }
    catch (error) {
        console.error('Error fetching home state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getHomeState = getHomeState;
