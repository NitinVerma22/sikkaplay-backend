"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUpi = exports.getTransactions = exports.updateFcmToken = exports.getProfile = void 0;
const db_1 = require("../config/db");
const getProfile = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 20, // Limit to 20 recent transactions
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Exclude passwordHash from response
        const { passwordHash, ...userProfile } = user;
        res.status(200).json({ user: userProfile });
    }
    catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getProfile = getProfile;
const updateFcmToken = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { token } = req.body;
        if (!userId || !token) {
            res.status(400).json({ error: 'Missing user ID or token' });
            return;
        }
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { fcmToken: token }
        });
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error updating FCM token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateFcmToken = updateFcmToken;
const getTransactions = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        // Only query transactions from the last 3 days
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const transactions = await db_1.prisma.transaction.findMany({
            where: {
                userId,
                createdAt: { gte: threeDaysAgo }
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        });
        const total = await db_1.prisma.transaction.count({
            where: {
                userId,
                createdAt: { gte: threeDaysAgo }
            }
        });
        res.status(200).json({
            success: true,
            transactions,
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / limit))
        });
    }
    catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getTransactions = getTransactions;
const updateUpi = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { upiId } = req.body;
        if (!userId || upiId === undefined) {
            res.status(400).json({ error: 'Missing user ID or UPI ID' });
            return;
        }
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { upiId }
        });
        res.status(200).json({ success: true, message: 'UPI ID updated successfully' });
    }
    catch (error) {
        console.error('Error updating UPI ID:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateUpi = updateUpi;
