"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronJobs = exports.pruneOldGameSessions = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("../config/db");
const push_service_1 = require("./push.service");
const network_service_1 = require("./network.service");
const pruneOldGameSessions = async () => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const deleteResult = await db_1.prisma.gameSession.deleteMany({
            where: {
                createdAt: { lt: twentyFourHoursAgo }
            }
        });
        console.log(`[PRUNING] Pruned ${deleteResult.count} game sessions older than 24 hours.`);
    }
    catch (error) {
        console.error('Error running GameSession pruning:', error);
    }
};
exports.pruneOldGameSessions = pruneOldGameSessions;
const startCronJobs = () => {
    // Process any pending commissions immediately on startup
    (0, network_service_1.distributePendingReferralCommissions)().catch(e => console.error('Error processing startup commissions:', e));
    // Prune game sessions immediately on startup
    (0, exports.pruneOldGameSessions)().catch(e => console.error('Error processing startup pruning:', e));
    // Run daily at 02:00 AM to prune game sessions older than 24 hours
    node_cron_1.default.schedule('0 2 * * *', async () => {
        console.log('Running daily cron job for GameSession pruning...');
        await (0, exports.pruneOldGameSessions)();
    });
    // Run every night at midnight (00:00)
    node_cron_1.default.schedule('0 0 * * *', async () => {
        console.log('Running daily cron job for referral rewards...');
        try {
            await evaluateDailyMilestones();
        }
        catch (error) {
            console.error('Error running daily cron job:', error);
        }
    });
    // Run every 3 hours (0 */3 * * *) for referral commission distribution
    node_cron_1.default.schedule('0 */3 * * *', async () => {
        console.log('Running 3-hourly cron job for referral commission distribution...');
        try {
            await (0, network_service_1.distributePendingReferralCommissions)();
        }
        catch (error) {
            console.error('Error running 3-hourly referral cron job:', error);
        }
    });
    // Also run every hour to check for 3 hour inactivity
    node_cron_1.default.schedule('0 * * * *', async () => {
        try {
            console.log('Checking for 3-hour inactivity...');
            // Get all users whose last usage updated > 3 hours ago
            const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const usersToRemind = await db_1.prisma.user.findMany({
                where: {
                    fcmToken: { not: null },
                    updatedAt: { lt: threeHoursAgo }
                },
                select: { id: true, fcmToken: true, name: true },
                take: 1000 // limit batch size
            });
            const userIdsToUpdate = usersToRemind.filter(u => u.fcmToken).map(u => u.id);
            for (const user of usersToRemind) {
                if (user.fcmToken) {
                    (0, push_service_1.sendPushNotification)(user.fcmToken, 'Aao khelo Sikka!', `${user.name || 'Champion'}, Sikka aapka wait kar raha hai. Abhi khel ke coins jeeto!`, 'alert', null, user.id).catch(e => console.error(`Failed to send inactivity push to ${user.id}:`, e));
                }
            }
            if (userIdsToUpdate.length > 0) {
                await db_1.prisma.user.updateMany({
                    where: {
                        id: { in: userIdsToUpdate }
                    },
                    data: {
                        updatedAt: new Date()
                    }
                });
            }
        }
        catch (error) {
            console.error('Error in inactivity cron:', error);
        }
    });
};
exports.startCronJobs = startCronJobs;
const evaluateDailyMilestones = async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    // Get all users who played more than 40 mins yesterday
    const allUsages = await db_1.prisma.dailyUsage.findMany({
        where: {
            dateStr: yesterdayStr,
        },
        include: {
            user: {
                select: { id: true, referredBy: true, createdAt: true }
            }
        }
    });
    const activeUsages = allUsages.filter(u => (u.reelsMinutes + u.gamesMinutes) >= 40);
    for (const usage of activeUsages) {
        if (!usage.user.referredBy)
            continue;
        const referrer = await db_1.prisma.user.findUnique({
            where: { referralCode: usage.user.referredBy }
        });
        if (!referrer)
            continue;
        // Check if the referrer has already received 10 daily rewards for this user
        const rewardCount = await db_1.prisma.referralReward.count({
            where: {
                userId: usage.user.id,
                referrerId: referrer.id,
                milestone: 'daily_50'
            }
        });
        if (rewardCount < 10) {
            // Award 50 coins to referrer
            await db_1.prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: referrer.id },
                    data: { referralBalance: { increment: 50 } }
                });
                await tx.transaction.create({
                    data: {
                        userId: referrer.id,
                        amount: 50,
                        type: 'network_income',
                        status: 'success',
                        description: `Daily Active Bonus from referred user`,
                    }
                });
                await tx.referralReward.create({
                    data: {
                        userId: usage.user.id,
                        referrerId: referrer.id,
                        milestone: 'daily_50',
                        dateStr: yesterdayStr
                    }
                });
            });
        }
        // Check for 30-day jackpot (45 hours = 2700 minutes)
        const daysSinceSignup = Math.floor((Date.now() - usage.user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceSignup >= 30) {
            // Check if jackpot already given
            const jackpotGiven = await db_1.prisma.referralReward.findFirst({
                where: {
                    userId: usage.user.id,
                    referrerId: referrer.id,
                    milestone: '30_days_jackpot'
                }
            });
            if (!jackpotGiven) {
                // Calculate total playtime
                const totalPlaytime = await db_1.prisma.dailyUsage.aggregate({
                    where: { userId: usage.user.id },
                    _sum: { reelsMinutes: true, gamesMinutes: true }
                });
                const totalMins = (totalPlaytime._sum.reelsMinutes || 0) + (totalPlaytime._sum.gamesMinutes || 0);
                // Count active days
                const allUserDays = await db_1.prisma.dailyUsage.findMany({
                    where: { userId: usage.user.id }
                });
                const activeDays = allUserDays.filter(d => (d.reelsMinutes + d.gamesMinutes) >= 10).length;
                // Jackpot criteria: 2700 minutes (45 hours) AND at least 20 active days out of 30
                if (totalMins >= 2700 && activeDays >= 20) {
                    await db_1.prisma.$transaction(async (tx) => {
                        await tx.user.update({
                            where: { id: referrer.id },
                            data: { referralBalance: { increment: 8400 } }
                        });
                        await tx.transaction.create({
                            data: {
                                userId: referrer.id,
                                amount: 8400,
                                type: 'network_income',
                                status: 'success',
                                description: `30-Day Jackpot Bonus from referred user`,
                            }
                        });
                        await tx.referralReward.create({
                            data: {
                                userId: usage.user.id,
                                referrerId: referrer.id,
                                milestone: '30_days_jackpot',
                            }
                        });
                    });
                }
            }
        }
    }
};
