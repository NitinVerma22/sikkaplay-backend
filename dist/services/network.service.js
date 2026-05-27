"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distributeLevelIncome = void 0;
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
