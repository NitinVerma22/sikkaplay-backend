"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distributePendingReferralCommissions = exports.distributeLevelIncome = void 0;
const db_1 = require("../config/db");
const push_service_1 = require("./push.service");
/**
 * Distributes network level income when a user earns coins.
 * Level 1 (Direct Referrer): 10%
 * Level 2 (Referrer's Referrer): 5%
 * Level 3: 2%
 */
const distributeLevelIncome = async (userId, earnedAmount, sourceDescription) => {
    if (earnedAmount <= 0)
        return;
    try {
        // 1. Get the user and their referrer
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, referredBy: true }
        });
        if (!user || !user.referredBy)
            return; // No referrer to reward
        // Level 1
        const level1Referrer = await db_1.prisma.user.findUnique({ where: { referralCode: user.referredBy } });
        if (level1Referrer) {
            const l1Reward = Math.floor(earnedAmount * 0.10);
            if (l1Reward > 0) {
                await awardReferralBalance(level1Referrer.id, l1Reward, `Level 1 Commission from ${user.name || 'User'}`);
                // Level 2
                if (level1Referrer.referredBy) {
                    const level2Referrer = await db_1.prisma.user.findUnique({ where: { referralCode: level1Referrer.referredBy } });
                    if (level2Referrer) {
                        const l2Reward = Math.floor(earnedAmount * 0.05);
                        if (l2Reward > 0) {
                            await awardReferralBalance(level2Referrer.id, l2Reward, `Level 2 Commission from ${user.name || 'User'}`);
                            // Level 3
                            if (level2Referrer.referredBy) {
                                const level3Referrer = await db_1.prisma.user.findUnique({ where: { referralCode: level2Referrer.referredBy } });
                                if (level3Referrer) {
                                    const l3Reward = Math.floor(earnedAmount * 0.02);
                                    if (l3Reward > 0) {
                                        await awardReferralBalance(level3Referrer.id, l3Reward, `Level 3 Commission from ${user.name || 'User'}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    catch (error) {
        console.error('Error distributing level income:', error);
    }
};
exports.distributeLevelIncome = distributeLevelIncome;
const awardReferralBalance = async (userId, amount, description) => {
    await db_1.prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: userId },
            data: { referralBalance: { increment: amount } }
        });
        await tx.transaction.create({
            data: {
                userId,
                amount,
                type: 'network_income',
                status: 'success',
                description,
            }
        });
        // Fetch user again to get FCM Token (since we need it to send push)
        const userForPush = await tx.user.findUnique({
            where: { id: userId },
            select: { fcmToken: true }
        });
        if (userForPush?.fcmToken) {
            (0, push_service_1.sendPushNotification)(userForPush.fcmToken, 'You earned Network Income!', `You just received ${amount} coins from your referral network!`);
        }
    });
};
const distributePendingReferralCommissions = async () => {
    console.log('Starting batch distribution of pending referral commissions...');
    try {
        // 1. Fetch all successfully completed transactions that are not processed yet
        const pendingTransactions = await db_1.prisma.transaction.findMany({
            where: {
                isReferralProcessed: false,
                type: 'earning',
                status: 'success',
                amount: { gt: 0 }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        phoneNumber: true,
                        referredBy: true
                    }
                }
            }
        });
        if (pendingTransactions.length === 0) {
            console.log('No pending referral commissions to distribute.');
            return;
        }
        console.log(`Processing ${pendingTransactions.length} pending transaction(s)...`);
        // Cache to look up users by referralCode to prevent redundant DB calls
        const userCacheByReferralCode = new Map();
        const getUserByReferral = async (referralCode) => {
            if (userCacheByReferralCode.has(referralCode)) {
                return userCacheByReferralCode.get(referralCode);
            }
            const u = await db_1.prisma.user.findUnique({
                where: { referralCode }
            });
            userCacheByReferralCode.set(referralCode, u);
            return u;
        };
        // Referrer ID -> accumulated commission amount
        const accumulatedCommissions = new Map();
        // Step 2: Loop through transactions and compute level commission distribution in-memory
        for (const tx of pendingTransactions) {
            const user = tx.user;
            if (!user || !user.referredBy)
                continue;
            // Level 1 Referrer
            const l1Referrer = await getUserByReferral(user.referredBy);
            if (!l1Referrer)
                continue;
            const l1Reward = Math.floor(tx.amount * 0.10);
            if (l1Reward > 0) {
                accumulatedCommissions.set(l1Referrer.id, (accumulatedCommissions.get(l1Referrer.id) || 0) + l1Reward);
                // Level 2 Referrer
                if (l1Referrer.referredBy) {
                    const l2Referrer = await getUserByReferral(l1Referrer.referredBy);
                    if (l2Referrer) {
                        const l2Reward = Math.floor(tx.amount * 0.05);
                        if (l2Reward > 0) {
                            accumulatedCommissions.set(l2Referrer.id, (accumulatedCommissions.get(l2Referrer.id) || 0) + l2Reward);
                            // Level 3 Referrer
                            if (l2Referrer.referredBy) {
                                const l3Referrer = await getUserByReferral(l2Referrer.referredBy);
                                if (l3Referrer) {
                                    const l3Reward = Math.floor(tx.amount * 0.02);
                                    if (l3Reward > 0) {
                                        accumulatedCommissions.set(l3Referrer.id, (accumulatedCommissions.get(l3Referrer.id) || 0) + l3Reward);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Step 3: Apply the accumulated commissions to referrers
        for (const [referrerId, totalAmount] of accumulatedCommissions.entries()) {
            if (totalAmount <= 0)
                continue;
            try {
                await db_1.prisma.$transaction(async (tx) => {
                    // Update user balance
                    await tx.user.update({
                        where: { id: referrerId },
                        data: {
                            referralBalance: { increment: totalAmount }
                        }
                    });
                    // Create summary transaction
                    await tx.transaction.create({
                        data: {
                            userId: referrerId,
                            amount: totalAmount,
                            type: 'network_income',
                            status: 'success',
                            description: `Referral commission summary (last 3 hours)`,
                            isReferralProcessed: true // Don't process summary transactions recursively
                        }
                    });
                    // Fetch referrer fcmToken to notify
                    const referrer = await tx.user.findUnique({
                        where: { id: referrerId },
                        select: { fcmToken: true }
                    });
                    if (referrer?.fcmToken) {
                        (0, push_service_1.sendPushNotification)(referrer.fcmToken, 'You earned Network Income! ⚡', `You earned ${totalAmount} coins from your referral network in the last 3 hours!`);
                    }
                });
            }
            catch (err) {
                console.error(`Error applying batch commission to referrer ${referrerId}:`, err);
            }
        }
        // Step 4: Mark all processed transactions as processed
        const processedTxIds = pendingTransactions.map(tx => tx.id);
        await db_1.prisma.transaction.updateMany({
            where: {
                id: { in: processedTxIds }
            },
            data: {
                isReferralProcessed: true
            }
        });
        console.log(`Successfully completed batch distribution for ${processedTxIds.length} transactions.`);
    }
    catch (error) {
        console.error('Error in distributePendingReferralCommissions:', error);
    }
};
exports.distributePendingReferralCommissions = distributePendingReferralCommissions;
