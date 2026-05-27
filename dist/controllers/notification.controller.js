"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearNotifications = exports.markAsRead = exports.getNotifications = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const getNotifications = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50, // Limit to 50 recent notifications
        });
        res.json({ success: true, notifications });
    }
    catch (error) {
        console.error('Get Notifications Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
exports.getNotifications = getNotifications;
const markAsRead = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { notificationId } = req.body;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (notificationId) {
            await prisma.notification.updateMany({
                where: { id: notificationId, userId },
                data: { isRead: true },
            });
        }
        else {
            // Mark all as read
            await prisma.notification.updateMany({
                where: { userId, isRead: false },
                data: { isRead: true },
            });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Mark Read Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
exports.markAsRead = markAsRead;
const clearNotifications = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        await prisma.notification.deleteMany({
            where: { userId },
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Clear Notifications Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
exports.clearNotifications = clearNotifications;
