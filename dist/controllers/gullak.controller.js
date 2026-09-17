"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimGullakReward = exports.incrementGullak = void 0;
const db_1 = require("../config/db");

const MAX_WIN600_GULLAKS = 9;
const FINAL_REWARD_COINS = 150;

const getUserById = async (tx, userId) => {
    return tx.user.findUnique({ where: { id: userId } });
};

/**
 * Adds exactly one Win600 progress step after a successfully completed normal
 * game Gullak claim. The operation is capped at 9 and never resets progress.
 */
const incrementGullak = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const result = await db_1.prisma.$transaction(async (tx) => {
            const user = await getUserById(tx, userId);
            if (!user) {
                throw new Error('USER_NOT_FOUND');
            }

            const current = Math.max(0, Math.min(MAX_WIN600_GULLAKS, Number(user.win600UnlockedGullaks || 0)));
            const next = Math.min(MAX_WIN600_GULLAKS, current + 1);

            if (next !== current) {
                await tx.user.update({
                    where: { id: userId },
                    data: { win600UnlockedGullaks: next },
                });
            }

            return next;
        });

        res.status(200).json({
            success: true,
            unlockedGullaks: result,
            maxGullaks: MAX_WIN600_GULLAKS,
        });
    }
    catch (error) {
        console.error('Error incrementing Win600 Gullak:', error);
        if (error?.message === 'USER_NOT_FOUND') {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.incrementGullak = incrementGullak;

/**
 * Claims the 150-coin Win600 gift and atomically resets progress to 0.
 * This endpoint is the only operation that resets Win600 progress.
 */
const claimGullakReward = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const result = await db_1.prisma.$transaction(async (tx) => {
            const user = await getUserById(tx, userId);
            if (!user) {
                throw new Error('USER_NOT_FOUND');
            }

            const current = Math.max(0, Math.min(MAX_WIN600_GULLAKS, Number(user.win600UnlockedGullaks || 0)));
            if (current < MAX_WIN600_GULLAKS) {
                throw new Error('WIN600_NOT_READY');
            }

            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: FINAL_REWARD_COINS },
                    totalEarned: { increment: FINAL_REWARD_COINS },
                    win600UnlockedGullaks: 0,
                },
                select: {
                    balance: true,
                    totalEarned: true,
                    win600UnlockedGullaks: true,
                },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: FINAL_REWARD_COINS,
                    type: 'earning',
                    description: 'Win600 Gullak reward',
                },
            });

            return updatedUser;
        });

        res.status(200).json({
            success: true,
            coinsEarned: FINAL_REWARD_COINS,
            balance: result.balance,
            totalEarned: result.totalEarned,
            unlockedGullaks: result.win600UnlockedGullaks,
        });
    }
    catch (error) {
        console.error('Error claiming Win600 Gullak reward:', error);
        if (error?.message === 'USER_NOT_FOUND') {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (error?.message === 'WIN600_NOT_READY') {
            res.status(400).json({ error: 'Win600 reward is not ready yet' });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.claimGullakReward = claimGullakReward;
