"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimReward = void 0;
const db_1 = require("../config/db");
const date_utils_1 = require("../utils/date.utils");
const crypto_1 = __importDefault(require("crypto"));
const claimReward = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { amount, type, description } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        const signature = req.headers['x-signature'];
        const timestamp = req.headers['x-timestamp'];
        let API_SIGNING_SECRET = process.env.API_SIGNING_SECRET || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
        // Strip double/single quotes from the environment secret if present
        if (API_SIGNING_SECRET.startsWith('"') && API_SIGNING_SECRET.endsWith('"')) {
            API_SIGNING_SECRET = API_SIGNING_SECRET.substring(1, API_SIGNING_SECRET.length - 1);
        }
        else if (API_SIGNING_SECRET.startsWith("'") && API_SIGNING_SECRET.endsWith("'")) {
            API_SIGNING_SECRET = API_SIGNING_SECRET.substring(1, API_SIGNING_SECRET.length - 1);
        }
        if (!signature || !timestamp) {
            console.error('Signature verification failed: Missing x-signature or x-timestamp headers.', { signature, timestamp });
            res.status(403).json({ error: 'Forbidden: Missing request signature verification' });
            return;
        }
        const requestTime = parseInt(timestamp, 10);
        const now = Date.now();
        const timeDiff = Math.abs(now - requestTime);
        // Allow up to 15 minutes clock drift to prevent failures on devices with slightly incorrect time
        if (isNaN(requestTime) || timeDiff > 15 * 60 * 1000) {
            console.error('Signature verification failed: Timestamp expired or invalid.', { timestamp, requestTime, now, timeDiffMs: timeDiff });
            res.status(403).json({ error: 'Forbidden: Signature verification expired' });
            return;
        }
        const rawMessage = `${amount}:${type}:${timestamp}`;
        const expectedSignature = crypto_1.default
            .createHmac('sha256', API_SIGNING_SECRET)
            .update(rawMessage)
            .digest('hex');
        if (signature !== expectedSignature) {
            console.error('Signature verification failed: Signature mismatch details:', {
                amount,
                type,
                timestamp,
                rawMessage,
                receivedSignature: signature,
                expectedSignature,
                secretLength: API_SIGNING_SECRET.length,
                secretStart: API_SIGNING_SECRET.substring(0, 3) + '...',
                secretEnd: '...' + API_SIGNING_SECRET.substring(API_SIGNING_SECRET.length - 3)
            });
            res.status(403).json({ error: 'Forbidden: Invalid request signature' });
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
        // Prevent double claiming of daily streak
        if (type === 'daily_streak') {
            const startOfToday = (0, date_utils_1.getStartOfTodayIST)();
            const streakToday = await db_1.prisma.transaction.findFirst({
                where: {
                    userId,
                    type: 'daily_streak',
                    createdAt: { gte: startOfToday }
                }
            });
            if (streakToday) {
                res.status(400).json({ error: 'Daily streak already claimed today' });
                return;
            }
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
