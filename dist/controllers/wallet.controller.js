"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestWithdrawal = exports.getWalletStats = void 0;
const db_1 = require("../config/db");
const date_utils_1 = require("../utils/date.utils");
const getWalletStats = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const now = new Date();
        const startOfToday = (0, date_utils_1.getStartOfTodayIST)(now);
        const startOfYesterday = (0, date_utils_1.getStartOfYesterdayIST)(now);
        const startOfWeek = (0, date_utils_1.getStartOfWeekIST)(now);
        const startOfMonth = (0, date_utils_1.getStartOfMonthIST)(now);
        // Fetch all successful earning transactions for the user
        // type in ['earning', 'referral_level_income', 'bonus', 'daily_streak', 'social_task']
        const transactions = await db_1.prisma.transaction.findMany({
            where: {
                userId,
                status: 'success',
                type: {
                    not: 'withdrawal' // We only want earnings
                }
            },
            select: {
                amount: true,
                createdAt: true,
                type: true
            }
        });
        const stats = {
            self: { today: 0, yesterday: 0, weekly: 0, monthly: 0, total: 0 },
            referral: { today: 0, yesterday: 0, weekly: 0, monthly: 0, total: 0 }
        };
        for (const tx of transactions) {
            const isReferral = tx.type === 'referral_level_income' || tx.type === 'network_income';
            const target = isReferral ? stats.referral : stats.self;
            target.total += tx.amount;
            if (tx.createdAt >= startOfToday) {
                target.today += tx.amount;
            }
            else if (tx.createdAt >= startOfYesterday) {
                target.yesterday += tx.amount;
            }
            if (tx.createdAt >= startOfWeek) {
                target.weekly += tx.amount;
            }
            if (tx.createdAt >= startOfMonth) {
                target.monthly += tx.amount;
            }
        }
        // Fetch sum of pending withdrawals
        const pendingWithdrawalAmount = await db_1.prisma.transaction.aggregate({
            where: {
                userId,
                type: 'withdrawal',
                status: 'pending'
            },
            _sum: {
                amount: true
            }
        });
        const pendingWithdrawal = Math.abs(pendingWithdrawalAmount._sum.amount || 0);
        res.status(200).json({
            success: true,
            stats: {
                ...stats,
                pendingWithdrawal
            }
        });
    }
    catch (error) {
        console.error('Error fetching wallet stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getWalletStats = getWalletStats;
const requestWithdrawal = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { amount, upiId, earningType } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!amount || amount <= 0) {
            res.status(400).json({ error: 'Invalid withdrawal amount' });
            return;
        }
        // 1. Fetch user and app configuration
        const [user, config] = await Promise.all([
            db_1.prisma.user.findUnique({ where: { id: userId } }),
            db_1.prisma.appConfig.findFirst()
        ]);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const minLimit = config?.minWithdrawalLimit || 1000;
        if (amount < minLimit) {
            res.status(400).json({ error: `Minimum withdrawal amount is ${minLimit} coins` });
            return;
        }
        const targetEarningType = earningType === 'referral' ? 'referral' : 'self';
        if (targetEarningType === 'referral') {
            if (user.referralBalance < amount) {
                res.status(400).json({ error: 'Insufficient referral balance' });
                return;
            }
            // Check referral withdrawal eligibility:
            // A. Play time >= 50 hours (3000 minutes)
            const usages = await db_1.prisma.dailyUsage.findMany({ where: { userId } });
            const personalPlaytime = usages.reduce((acc, u) => acc + u.reelsMinutes + u.gamesMinutes, 0);
            if (personalPlaytime < 3000) {
                res.status(400).json({
                    error: `You need at least 50 hours of playtime to withdraw referral earnings. You currently have ${(personalPlaytime / 60).toFixed(1)} hours.`
                });
                return;
            }
            // B. Active referrals (direct Level 1 referred users) >= 2
            const activeReferralsCount = await db_1.prisma.user.count({
                where: { referredBy: user.referralCode }
            });
            if (activeReferralsCount < 2) {
                res.status(400).json({
                    error: `You need at least 2 active referrals to withdraw referral earnings. You currently have ${activeReferralsCount}.`
                });
                return;
            }
        }
        else {
            if (user.balance < amount) {
                res.status(400).json({ error: 'Insufficient balance' });
                return;
            }
        }
        const targetUpi = upiId || user.upiId;
        if (!targetUpi) {
            res.status(400).json({ error: 'UPI ID is required for withdrawal' });
            return;
        }
        // 2. Process withdrawal transaction and deduct correct balance pool
        if (targetEarningType === 'referral') {
            await db_1.prisma.$transaction([
                db_1.prisma.user.update({
                    where: { id: userId },
                    data: { referralBalance: { decrement: amount } }
                }),
                db_1.prisma.transaction.create({
                    data: {
                        userId,
                        amount: -amount, // Stored as a negative amount for withdrawals
                        type: 'withdrawal',
                        status: 'pending',
                        description: `Withdrawal request to UPI: ${targetUpi} (Referral Earning)`
                    }
                })
            ]);
        }
        else {
            await db_1.prisma.$transaction([
                db_1.prisma.user.update({
                    where: { id: userId },
                    data: { balance: { decrement: amount } }
                }),
                db_1.prisma.transaction.create({
                    data: {
                        userId,
                        amount: -amount, // Stored as a negative amount for withdrawals
                        type: 'withdrawal',
                        status: 'pending',
                        description: `Withdrawal request to UPI: ${targetUpi} (Self Earning)`
                    }
                })
            ]);
        }
        res.status(200).json({ success: true, message: 'Withdrawal request submitted successfully' });
    }
    catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.requestWithdrawal = requestWithdrawal;
