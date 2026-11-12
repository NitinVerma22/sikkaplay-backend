"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimGullakReward = exports.incrementGullak = void 0;
const db_1 = require("../config/db");
const gullakIncrementCooldown = new Map();
const incrementGullak = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // Assuming we stop at 9 and wait for claim to reset
        if (user.win600UnlockedGullaks >= 9) {
            return res.json({ success: true, count: user.win600UnlockedGullaks });
        }
        // Cooldown check (5 seconds minimum between increments) to prevent automated script spam
        const now = Date.now();
        const lastIncrement = gullakIncrementCooldown.get(userId) || 0;
        if (now - lastIncrement < 5000) {
            return res.json({ success: true, count: user.win600UnlockedGullaks });
        }
        gullakIncrementCooldown.set(userId, now);
        const updatedUser = await db_1.prisma.user.update({
            where: { id: userId },
            data: { win600UnlockedGullaks: { increment: 1 } },
        });
        return res.json({ success: true, count: updatedUser.win600UnlockedGullaks });
    }
    catch (error) {
        console.error('Error incrementing gullak:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
exports.incrementGullak = incrementGullak;
const claimGullakReward = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.win600UnlockedGullaks < 9) {
            return res.status(400).json({ error: 'Not enough gullaks unlocked' });
        }
        // Reset gullaks to 0 and give 150 coins
        const rewardAmount = 150;
        const updatedUser = await db_1.prisma.$transaction(async (tx) => {
            // Row lock user to prevent concurrent double-claims
            const lockedUsers = await tx.$queryRawUnsafe('SELECT "win600UnlockedGullaks" FROM "User" WHERE id = $1 FOR UPDATE', userId);
            if (!lockedUsers || lockedUsers.length === 0 || lockedUsers[0].win600UnlockedGullaks < 9) {
                throw new Error('Not enough gullaks unlocked');
            }
            const u = await tx.user.update({
                where: { id: userId },
                data: {
                    win600UnlockedGullaks: 0,
                    balance: { increment: rewardAmount },
                    totalEarned: { increment: rewardAmount },
                }
            });
            await tx.transaction.create({
                data: {
                    userId,
                    amount: rewardAmount,
                    type: 'earning',
                    status: 'success',
                    description: 'Claimed Win 600 Coins Gullak Reward',
                }
            });
            return u;
        });
        return res.json({ success: true, balance: updatedUser.balance });
    }
    catch (error) {
        console.error('Error claiming gullak reward:', error);
        return res.status(400).json({ error: error?.message || 'Internal server error' });
    }
};
exports.claimGullakReward = claimGullakReward;
