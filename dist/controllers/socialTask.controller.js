"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimSocialTaskUser = exports.deleteSocialTaskAdmin = exports.updateSocialTaskAdmin = exports.createSocialTaskAdmin = exports.getSocialTasksAdmin = void 0;
const db_1 = require("../config/db");
const home_controller_1 = require("./home.controller");
// --- ADMIN ENDPOINTS ---
// getSocialTasksAdmin: List all tasks in the admin panel
const getSocialTasksAdmin = async (req, res) => {
    try {
        const tasks = await db_1.prisma.socialTask.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { claims: true }
                }
            }
        });
        res.status(200).json({
            success: true,
            socialTasks: tasks.map(t => ({
                id: t.id,
                platform: t.platform,
                title: t.title,
                link: t.link,
                coinsReward: t.coinsReward,
                claimsCount: t._count.claims,
                createdAt: t.createdAt
            }))
        });
    }
    catch (error) {
        console.error('Error fetching social tasks for admin:', error);
        res.status(500).json({ error: 'Internal server error while fetching social tasks' });
    }
};
exports.getSocialTasksAdmin = getSocialTasksAdmin;
// createSocialTaskAdmin: Create a new social task
const createSocialTaskAdmin = async (req, res) => {
    try {
        const { platform, title, link, coins } = req.body;
        if (!platform || !['facebook', 'instagram', 'whatsapp', 'telegram', 'youtube', 'other'].includes(platform)) {
            res.status(400).json({ error: 'Invalid or missing platform' });
            return;
        }
        if (!title || typeof title !== 'string' || title.trim() === '') {
            res.status(400).json({ error: 'Title is required' });
            return;
        }
        if (!link || typeof link !== 'string' || link.trim() === '') {
            res.status(400).json({ error: 'Link is required' });
            return;
        }
        const coinsReward = typeof coins === 'number' ? coins : parseInt(coins) || 50;
        if (coinsReward <= 0) {
            res.status(400).json({ error: 'Coins reward must be greater than 0' });
            return;
        }
        const newTask = await db_1.prisma.socialTask.create({
            data: {
                platform,
                title: title.trim(),
                link: link.trim(),
                coinsReward
            }
        });
        (0, home_controller_1.invalidateSocialTasksCache)();
        res.status(200).json({
            success: true,
            message: 'Social task created successfully',
            socialTask: newTask
        });
    }
    catch (error) {
        console.error('Error creating social task:', error);
        res.status(500).json({ error: 'Internal server error while creating social task' });
    }
};
exports.createSocialTaskAdmin = createSocialTaskAdmin;
// updateSocialTaskAdmin: Update an existing social task
const updateSocialTaskAdmin = async (req, res) => {
    try {
        const id = req.params.id;
        const { platform, title, link, coins } = req.body;
        const task = await db_1.prisma.socialTask.findUnique({
            where: { id }
        });
        if (!task) {
            res.status(404).json({ error: 'Social task not found' });
            return;
        }
        if (platform && !['facebook', 'instagram', 'whatsapp', 'telegram', 'youtube', 'other'].includes(platform)) {
            res.status(400).json({ error: 'Invalid platform specified' });
            return;
        }
        const updateData = {};
        if (platform)
            updateData.platform = platform;
        if (title)
            updateData.title = title.trim();
        let linkChanged = false;
        if (link && link.trim() !== task.link) {
            updateData.link = link.trim();
            linkChanged = true;
        }
        if (coins !== undefined) {
            const parsedCoins = typeof coins === 'number' ? coins : parseInt(coins) || 50;
            if (parsedCoins <= 0) {
                res.status(400).json({ error: 'Coins reward must be greater than 0' });
                return;
            }
            updateData.coinsReward = parsedCoins;
        }
        const updatedTask = await db_1.prisma.socialTask.update({
            where: { id },
            data: updateData
        });
        // If the link changed, delete all previous claims for this task so users can claim again!
        if (linkChanged) {
            await db_1.prisma.socialTaskClaim.deleteMany({
                where: { socialTaskId: id }
            });
        }
        (0, home_controller_1.invalidateSocialTasksCache)();
        res.status(200).json({
            success: true,
            message: linkChanged
                ? 'Social task updated successfully (claims reset due to link update)'
                : 'Social task updated successfully',
            socialTask: updatedTask
        });
    }
    catch (error) {
        console.error('Error updating social task:', error);
        res.status(500).json({ error: 'Internal server error while updating social task' });
    }
};
exports.updateSocialTaskAdmin = updateSocialTaskAdmin;
// deleteSocialTaskAdmin: Delete a social task
const deleteSocialTaskAdmin = async (req, res) => {
    try {
        const id = req.params.id;
        const task = await db_1.prisma.socialTask.findUnique({
            where: { id }
        });
        if (!task) {
            res.status(404).json({ error: 'Social task not found' });
            return;
        }
        await db_1.prisma.socialTask.delete({
            where: { id }
        });
        (0, home_controller_1.invalidateSocialTasksCache)();
        res.status(200).json({
            success: true,
            message: 'Social task deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting social task:', error);
        res.status(500).json({ error: 'Internal server error while deleting social task' });
    }
};
exports.deleteSocialTaskAdmin = deleteSocialTaskAdmin;
// --- USER ENDPOINTS ---
// claimSocialTaskUser: Claims the coins reward for a completed social task
const claimSocialTaskUser = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const id = req.params.id; // social task id
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const task = await db_1.prisma.socialTask.findUnique({
            where: { id }
        });
        if (!task) {
            res.status(404).json({ error: 'Social task not found' });
            return;
        }
        // Verify user has not already claimed this task
        const existingClaim = await db_1.prisma.socialTaskClaim.findUnique({
            where: {
                userId_socialTaskId: {
                    userId,
                    socialTaskId: id
                }
            }
        });
        if (existingClaim) {
            res.status(400).json({ error: 'Social task already claimed' });
            return;
        }
        const coinsReward = task.coinsReward;
        const result = await db_1.prisma.$transaction(async (tx) => {
            // Lock user row
            await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', userId);
            // Increment balance
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: coinsReward },
                    totalEarned: { increment: coinsReward }
                }
            });
            // Record transaction
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: coinsReward,
                    type: 'social_task',
                    status: 'success',
                    description: `Joined ${task.platform}: ${task.link}`
                }
            });
            // Record claim
            await tx.socialTaskClaim.create({
                data: {
                    userId,
                    socialTaskId: id
                }
            });
            return { user: updatedUser, transaction };
        });
        res.status(200).json({
            success: true,
            message: 'Coins claimed successfully!',
            balance: result.user.balance,
            totalEarned: result.user.totalEarned,
            transaction: result.transaction
        });
    }
    catch (error) {
        console.error('Error claiming social task:', error);
        res.status(500).json({ error: 'Internal server error while claiming social task' });
    }
};
exports.claimSocialTaskUser = claimSocialTaskUser;
