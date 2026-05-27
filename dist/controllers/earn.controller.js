"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimReward = void 0;
const db_1 = require("../config/db");
const network_service_1 = require("../services/network.service");
const claimReward = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { amount, type, description } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        if (typeof amount !== 'number') {
            res.status(400).json({ error: 'Invalid amount' });
            return;
        }
        if (!type || typeof type !== 'string') {
            res.status(400).json({ error: 'Invalid reward type' });
            return;
        }
        // Execute within a transaction to ensure atomicity
        const result = await db_1.prisma.$transaction(async (tx) => {
            // 1. Update User Balance & Total Earned
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: amount },
                    totalEarned: { increment: amount },
                },
            });
            // 2. Create Transaction Record
            const newTransaction = await tx.transaction.create({
                data: {
                    userId,
                    amount,
                    type, // 'earning', 'bonus', etc.
                    status: 'success', // Auto success for simple tasks/rewards
                    description: description || `Claimed ${amount} coins for ${type}`,
                },
            });
            return { user: updatedUser, transaction: newTransaction };
        });
        // Trigger MLM distribution in the background (no need to await and block the response)
        if (amount > 0) {
            (0, network_service_1.distributeLevelIncome)(userId, amount, description || type).catch(e => console.error(e));
        }
        res.status(200).json({
            success: true,
            message: 'Reward claimed successfully',
            balance: result.user.balance,
            totalEarned: result.user.totalEarned,
            transaction: result.transaction,
        });
    }
    catch (error) {
        console.error('Error claiming reward:', error);
        res.status(500).json({ error: 'Internal server error while claiming reward' });
    }
};
exports.claimReward = claimReward;
