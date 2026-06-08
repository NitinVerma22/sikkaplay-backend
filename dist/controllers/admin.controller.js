"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuditLogs = exports.triggerReferralDistribution = exports.changeUserPassword = exports.broadcastPushNotification = exports.toggleUserFreeze = exports.replySupportTicket = exports.getSupportTickets = exports.bulkUpdateWithdrawalStatus = exports.updateWithdrawalStatus = exports.getWithdrawals = exports.bulkDeleteUsers = exports.deleteUser = exports.updateUserBalance = exports.getUsers = exports.updateConfigs = exports.getConfigs = exports.getDashboardStats = exports.loginAdmin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const push_service_1 = require("../services/push.service");
const network_service_1 = require("../services/network.service");
const audit_service_1 = require("../services/audit.service");
const config_service_1 = require("../services/config.service");
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
// 1. Admin Login
const loginAdmin = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            res.status(400).json({ error: 'Username and password are required' });
            return;
        }
        const admin = await db_1.prisma.admin.findUnique({ where: { username } });
        if (!admin) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const isMatch = await bcryptjs_1.default.compare(password, admin.password);
        if (!isMatch) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ adminId: admin.id, role: admin.role, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            admin: { id: admin.id, username: admin.username, role: admin.role }
        });
    }
    catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.loginAdmin = loginAdmin;
// 2. Get Dashboard Stats
const getDashboardStats = async (req, res) => {
    try {
        const totalUsers = await db_1.prisma.user.count();
        // Sum of user balances
        const userBalances = await db_1.prisma.user.aggregate({
            _sum: {
                balance: true,
                referralBalance: true,
                totalEarned: true,
                withdrawalAmount: true,
            }
        });
        // Count of pending withdrawals (transactions of type 'withdrawal' with 'pending' status)
        const pendingWithdrawalsCount = await db_1.prisma.transaction.count({
            where: { type: 'withdrawal', status: 'pending' }
        });
        // Sum of total paid/success withdrawals
        const totalWithdrawnAmount = await db_1.prisma.transaction.aggregate({
            where: { type: 'withdrawal', status: 'success' },
            _sum: { amount: true }
        });
        // Count of open support tickets (status 'pending' or 'in_progress')
        const openTicketsCount = await db_1.prisma.supportTicket.count({
            where: { status: { in: ['pending', 'in_progress'] } }
        });
        // Recent 10 transactions
        const recentTransactions = await db_1.prisma.transaction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
                user: {
                    select: { phoneNumber: true, name: true }
                }
            }
        });
        // --- REAL-TIME TIME-SERIES STATS FOR CHARTS ---
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); // Go back 5 months + current month = 6 months
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);
        const financeTxs = await db_1.prisma.transaction.findMany({
            where: {
                createdAt: { gte: sixMonthsAgo },
                status: 'success'
            },
            select: {
                amount: true,
                type: true,
                createdAt: true
            }
        });
        const newUsers = await db_1.prisma.user.findMany({
            where: {
                createdAt: { gte: sixMonthsAgo }
            },
            select: {
                createdAt: true
            }
        });
        const monthsList = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const name = monthNames[d.getMonth()];
            const dateStart = new Date(d.getFullYear(), d.getMonth(), 1);
            const dateEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
            monthsList.push({
                name,
                dateStart,
                dateEnd,
                earnings: 0,
                withdrawals: 0,
                users: 0
            });
        }
        for (const tx of financeTxs) {
            const txTime = tx.createdAt.getTime();
            for (const m of monthsList) {
                if (txTime >= m.dateStart.getTime() && txTime <= m.dateEnd.getTime()) {
                    if (tx.type === 'withdrawal') {
                        m.withdrawals += Math.abs(tx.amount);
                    }
                    else {
                        m.earnings += tx.amount;
                    }
                    break;
                }
            }
        }
        let runningUserCount = await db_1.prisma.user.count({
            where: {
                createdAt: { lt: sixMonthsAgo }
            }
        });
        for (const m of monthsList) {
            const monthlyRegs = newUsers.filter(u => {
                const uTime = u.createdAt.getTime();
                return uTime >= m.dateStart.getTime() && uTime <= m.dateEnd.getTime();
            }).length;
            runningUserCount += monthlyRegs;
            m.users = runningUserCount;
        }
        const monthlyStats = monthsList.map(m => ({
            name: m.name,
            earnings: m.earnings,
            withdrawals: m.withdrawals,
            users: m.users
        }));
        res.status(200).json({
            success: true,
            stats: {
                totalUsers,
                totalBalance: userBalances._sum.balance || 0,
                totalReferralBalance: userBalances._sum.referralBalance || 0,
                totalEarned: userBalances._sum.totalEarned || 0,
                pendingWithdrawalsCount,
                openTicketsCount,
                totalWithdrawn: Math.abs(totalWithdrawnAmount._sum.amount || 0),
            },
            recentTransactions,
            monthlyStats
        });
    }
    catch (error) {
        console.error('Get Stats Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getDashboardStats = getDashboardStats;
// 3. Configurations
const getConfigs = async (req, res) => {
    try {
        let config = await db_1.prisma.appConfig.findFirst();
        if (!config) {
            // Fallback fallback seed
            config = await db_1.prisma.appConfig.create({ data: {} });
        }
        res.status(200).json({ success: true, config });
    }
    catch (error) {
        console.error('Get Configs Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getConfigs = getConfigs;
const updateConfigs = async (req, res) => {
    try {
        const { id, createdAt, updatedAt, latestVersion, updateUrl, ...configData } = req.body;
        let config = await db_1.prisma.appConfig.findFirst();
        if (!config) {
            config = await db_1.prisma.appConfig.create({ data: configData });
        }
        else {
            config = await db_1.prisma.appConfig.update({
                where: { id: config.id },
                data: configData
            });
        }
        // Invalidate configuration cache to refresh it on the next fetch
        (0, config_service_1.invalidateConfigCache)();
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'UPDATE_CONFIG', configData, ip);
        res.status(200).json({ success: true, message: 'Configuration updated successfully', config });
    }
    catch (error) {
        console.error('Update Configs Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateConfigs = updateConfigs;
// 4. User Management
const getUsers = async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const where = {};
        if (search) {
            where.OR = [
                { phoneNumber: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { referralCode: { contains: search, mode: 'insensitive' } }
            ];
        }
        const users = await db_1.prisma.user.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        });
        const total = await db_1.prisma.user.count({ where });
        res.status(200).json({
            success: true,
            users,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (error) {
        console.error('Get Users Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getUsers = getUsers;
const updateUserBalance = async (req, res) => {
    try {
        const id = req.params.id;
        const { balance, type } = req.body; // type can be 'add' or 'set'
        if (balance === undefined) {
            res.status(400).json({ error: 'Balance value is required' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        let finalBalance = balance;
        if (type === 'add') {
            finalBalance = user.balance + balance;
        }
        const updatedUser = await db_1.prisma.user.update({
            where: { id },
            data: {
                balance: finalBalance,
                totalEarned: type === 'add' && balance > 0 ? user.totalEarned + balance : user.totalEarned
            }
        });
        // Create a transaction record for auditing
        await db_1.prisma.transaction.create({
            data: {
                userId: id,
                amount: type === 'add' ? balance : (balance - user.balance),
                type: 'bonus',
                status: 'success',
                description: 'Admin balance adjustment',
            }
        });
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'ADJUST_BALANCE', {
            userId: id,
            userPhone: user.phoneNumber,
            actionType: type,
            amount: balance,
            oldBalance: user.balance,
            newBalance: finalBalance
        }, ip);
        res.status(200).json({ success: true, message: 'User balance updated', user: updatedUser });
    }
    catch (error) {
        console.error('Update Balance Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateUserBalance = updateUserBalance;
const deleteUser = async (req, res) => {
    try {
        const id = req.params.id;
        // We should delete user dependencies first to satisfy foreign key constraints
        await db_1.prisma.transaction.deleteMany({ where: { userId: id } });
        await db_1.prisma.dailyUsage.deleteMany({ where: { userId: id } });
        await db_1.prisma.referralReward.deleteMany({ where: { userId: id } });
        await db_1.prisma.notification.deleteMany({ where: { userId: id } });
        await db_1.prisma.supportTicket.deleteMany({ where: { userId: id } });
        await db_1.prisma.visitEarnClaim.deleteMany({ where: { userId: id } });
        await db_1.prisma.dailyCodeClaim.deleteMany({ where: { userId: id } });
        await db_1.prisma.gameSession.deleteMany({ where: { userId: id } });
        await db_1.prisma.adImpression.deleteMany({ where: { userId: id } });
        await db_1.prisma.user.delete({ where: { id } });
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'DELETE_USER', { userId: id }, ip);
        res.status(200).json({ success: true, message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
exports.deleteUser = deleteUser;
const bulkDeleteUsers = async (req, res) => {
    try {
        const { userIds } = req.body;
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            res.status(400).json({ error: 'Missing or invalid userIds array' });
            return;
        }
        await db_1.prisma.$transaction([
            db_1.prisma.transaction.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.dailyUsage.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.referralReward.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.supportTicket.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.visitEarnClaim.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.dailyCodeClaim.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.gameSession.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.adImpression.deleteMany({ where: { userId: { in: userIds } } }),
            db_1.prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        ]);
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'BULK_DELETE_USERS', { userIds }, ip);
        res.status(200).json({ success: true, message: `${userIds.length} users deleted successfully` });
    }
    catch (error) {
        console.error('Bulk Delete Users Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
exports.bulkDeleteUsers = bulkDeleteUsers;
// 5. Withdrawal Requests Management
const getWithdrawals = async (req, res) => {
    try {
        const status = req.query.status || ''; // pending, success, failed
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const where = { type: 'withdrawal' };
        if (status) {
            where.status = status;
        }
        const withdrawals = await db_1.prisma.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: { name: true, phoneNumber: true, upiId: true }
                }
            }
        });
        const total = await db_1.prisma.transaction.count({ where });
        res.status(200).json({
            success: true,
            withdrawals,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (error) {
        console.error('Get Withdrawals Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getWithdrawals = getWithdrawals;
const processWithdrawal = async (txId, status, referenceId, adminId = 'unknown-id', adminName = 'unknown-admin', ipAddress) => {
    const tx = await db_1.prisma.transaction.findUnique({
        where: { id: txId },
        include: { user: true }
    });
    if (!tx || tx.type !== 'withdrawal') {
        throw new Error(`Withdrawal request ${txId} not found`);
    }
    if (tx.status !== 'pending') {
        throw new Error(`Withdrawal request ${txId} is already processed`);
    }
    const updatedTx = await db_1.prisma.$transaction(async (prismaTx) => {
        // 1. Update transaction status
        const updated = await prismaTx.transaction.update({
            where: { id: txId },
            data: {
                status,
                description: status === 'success'
                    ? `Withdrawal Successful. Ref ID: ${referenceId || 'N/A'}`
                    : 'Withdrawal Rejected/Failed.'
            }
        });
        // 2. If failed, refund the amount back to user's wallet
        if (status === 'failed') {
            const refundAmount = Math.abs(tx.amount);
            const isReferral = tx.description.includes('(Referral Earning)');
            console.log(`[WITHDRAWAL REJECT] Refunding ${refundAmount} coins to user ID: ${tx.userId} (Referral: ${isReferral})`);
            await prismaTx.user.update({
                where: { id: tx.userId },
                data: isReferral
                    ? { referralBalance: { increment: refundAmount } }
                    : { balance: { increment: refundAmount } }
            });
        }
        else if (status === 'success') {
            const withdrawAmount = Math.abs(tx.amount);
            console.log(`[WITHDRAWAL APPROVE] Incrementing withdrawalAmount by ${withdrawAmount} for user ID: ${tx.userId}`);
            // Increment withdrawalAmount stats
            await prismaTx.user.update({
                where: { id: tx.userId },
                data: {
                    withdrawalAmount: { increment: withdrawAmount }
                }
            });
        }
        return updated;
    });
    // Create a notification for the user
    const targetUser = await db_1.prisma.user.findUnique({
        where: { id: tx.userId },
        select: { fcmToken: true }
    });
    const notifTitle = status === 'success' ? 'Withdrawal Approved 💰' : 'Withdrawal Failed ❌';
    const notifBody = status === 'success'
        ? `Your withdrawal of ${Math.abs(tx.amount)} coins is successful. Ref: ${referenceId || 'N/A'}`
        : `Your withdrawal of ${Math.abs(tx.amount)} coins was rejected. Coins refunded to wallet.`;
    if (targetUser?.fcmToken) {
        await (0, push_service_1.sendPushNotification)(targetUser.fcmToken, notifTitle, notifBody, 'withdrawal', null, tx.userId);
    }
    else {
        await db_1.prisma.notification.create({
            data: {
                userId: tx.userId,
                title: notifTitle,
                body: notifBody,
                type: 'withdrawal'
            }
        });
    }
    await (0, audit_service_1.logAdminAction)(adminId, adminName, 'PROCESS_WITHDRAWAL', {
        transactionId: txId,
        userId: tx.userId,
        userPhone: tx.user.phoneNumber,
        amount: tx.amount,
        status,
        referenceId
    }, ipAddress);
    return updatedTx;
};
const updateWithdrawalStatus = async (req, res) => {
    try {
        const id = req.params.id;
        const { status, referenceId } = req.body; // status: 'success' or 'failed'
        if (!['success', 'failed'].includes(status)) {
            res.status(400).json({ error: 'Invalid status. Must be success or failed' });
            return;
        }
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const updatedTx = await processWithdrawal(id, status, referenceId, adminId, adminName, ip);
        res.status(200).json({ success: true, message: 'Withdrawal status updated', transaction: updatedTx });
    }
    catch (error) {
        console.error('Update Withdrawal Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
exports.updateWithdrawalStatus = updateWithdrawalStatus;
const bulkUpdateWithdrawalStatus = async (req, res) => {
    try {
        const { ids, status, referenceId } = req.body; // ids: 'all_pending' | string[], status: 'success' | 'failed'
        if (!['success', 'failed'].includes(status)) {
            res.status(400).json({ error: 'Invalid status. Must be success or failed' });
            return;
        }
        let targetIds = [];
        if (ids === 'all_pending') {
            const pendingTxs = await db_1.prisma.transaction.findMany({
                where: { type: 'withdrawal', status: 'pending' },
                select: { id: true }
            });
            targetIds = pendingTxs.map(t => t.id);
        }
        else if (Array.isArray(ids)) {
            targetIds = ids;
        }
        else {
            res.status(400).json({ error: 'ids must be "all_pending" or an array of strings' });
            return;
        }
        if (targetIds.length === 0) {
            res.status(200).json({ success: true, message: 'No withdrawals to process' });
            return;
        }
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const results = [];
        const errors = [];
        for (const id of targetIds) {
            try {
                const updated = await processWithdrawal(id, status, referenceId, adminId, adminName, ip);
                results.push(updated);
            }
            catch (err) {
                console.error(`Error processing bulk withdrawal ${id}:`, err);
                errors.push({ id, error: err.message || 'Error processing request' });
            }
        }
        res.status(200).json({
            success: true,
            message: `Successfully processed ${results.length} withdrawals. Errors: ${errors.length}`,
            processedCount: results.length,
            errors
        });
    }
    catch (error) {
        console.error('Bulk Update Withdrawal Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.bulkUpdateWithdrawalStatus = bulkUpdateWithdrawalStatus;
// 6. Support Tickets Management
const getSupportTickets = async (req, res) => {
    try {
        const status = req.query.status || ''; // pending, resolved
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const where = {};
        if (status) {
            where.status = status;
        }
        const tickets = await db_1.prisma.supportTicket.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: { name: true, phoneNumber: true }
                }
            }
        });
        const total = await db_1.prisma.supportTicket.count({ where });
        res.status(200).json({
            success: true,
            tickets,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (error) {
        console.error('Get Support Tickets Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getSupportTickets = getSupportTickets;
const replySupportTicket = async (req, res) => {
    try {
        const id = req.params.id;
        const { reply } = req.body;
        if (!reply || reply.trim() === '') {
            res.status(400).json({ error: 'Reply message is required' });
            return;
        }
        const ticket = await db_1.prisma.supportTicket.findUnique({ where: { id } });
        if (!ticket) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }
        const updatedTicket = await db_1.prisma.supportTicket.update({
            where: { id },
            data: {
                reply,
                status: 'resolved'
            }
        });
        // Notify user via push notification
        let ticketUser = null;
        if (ticket.userId) {
            ticketUser = await db_1.prisma.user.findUnique({
                where: { id: ticket.userId },
                select: { fcmToken: true }
            });
        }
        const ticketNotifTitle = 'Support Ticket Reply ✉️';
        const ticketNotifBody = `Support team replied to your ticket: "${reply.substring(0, 40)}..."`;
        if (ticketUser?.fcmToken) {
            await (0, push_service_1.sendPushNotification)(ticketUser.fcmToken, ticketNotifTitle, ticketNotifBody, 'alert', null, ticket.userId || undefined);
        }
        else if (ticket.userId) {
            await db_1.prisma.notification.create({
                data: {
                    userId: ticket.userId,
                    title: ticketNotifTitle,
                    body: ticketNotifBody,
                    type: 'alert'
                }
            });
        }
        res.status(200).json({ success: true, message: 'Reply sent and ticket resolved', ticket: updatedTicket });
    }
    catch (error) {
        console.error('Reply Ticket Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.replySupportTicket = replySupportTicket;
const toggleUserFreeze = async (req, res) => {
    try {
        const id = req.params.id;
        const user = await db_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const updatedUser = await db_1.prisma.user.update({
            where: { id },
            data: { isBlocked: !user.isBlocked }
        });
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'TOGGLE_FREEZE_USER', { userId: id, phone: user.phoneNumber, newFreezeState: updatedUser.isBlocked }, ip);
        res.status(200).json({ success: true, isBlocked: updatedUser.isBlocked });
    }
    catch (error) {
        console.error('Toggle User Freeze Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.toggleUserFreeze = toggleUserFreeze;
const broadcastPushNotification = async (req, res) => {
    try {
        const { title, body, type, targetType, phoneNumber, bannerUrl } = req.body;
        if (!title || !body) {
            res.status(400).json({ error: 'Title and body are required' });
            return;
        }
        const notificationType = type || 'alert';
        if (targetType === 'specific') {
            if (!phoneNumber) {
                res.status(400).json({ error: 'Phone number is required for specific targeting' });
                return;
            }
            let formattedPhone = phoneNumber.trim();
            if (!formattedPhone.startsWith('+')) {
                formattedPhone = '+91' + formattedPhone;
            }
            const user = await db_1.prisma.user.findUnique({
                where: { phoneNumber: formattedPhone },
                select: { id: true, fcmToken: true }
            });
            if (!user) {
                res.status(404).json({ error: 'User with this phone number not found' });
                return;
            }
            if (user.fcmToken) {
                await (0, push_service_1.sendPushNotification)(user.fcmToken, title, body, notificationType, bannerUrl, user.id);
            }
            else {
                await db_1.prisma.notification.create({
                    data: {
                        userId: user.id,
                        title,
                        body,
                        type: notificationType,
                        bannerUrl: bannerUrl || null,
                    }
                });
            }
        }
        else {
            let whereClause = {};
            if (targetType === 'inactive_2_days') {
                const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
                whereClause.updatedAt = { lt: twoDaysAgo };
            }
            else if (targetType === 'inactive_7_days') {
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                whereClause.updatedAt = { lt: sevenDaysAgo };
            }
            else if (targetType === 'zero_balance') {
                whereClause.balance = 0;
            }
            const users = await db_1.prisma.user.findMany({
                where: whereClause,
                select: { id: true, fcmToken: true }
            });
            if (users.length === 0) {
                res.status(200).json({ success: true, message: 'No users matched the criteria.' });
                return;
            }
            // Create database notifications in bulk for all target users
            const dbEntries = users.map(u => ({
                userId: u.id,
                title,
                body,
                type: notificationType,
                bannerUrl: bannerUrl || null,
            }));
            if (dbEntries.length > 0) {
                await db_1.prisma.notification.createMany({ data: dbEntries });
            }
            // Send push notifications in batches via FCM
            const usersWithToken = users.filter(u => u.fcmToken);
            const tokens = usersWithToken.map(u => u.fcmToken);
            if (tokens.length > 0) {
                await (0, push_service_1.sendPushNotificationBatch)(tokens, title, body, notificationType, bannerUrl);
            }
        }
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'BROADCAST_NOTIFICATION', { title, type, targetType, phoneNumber }, ip);
        res.status(200).json({ success: true, message: 'Notifications sent successfully' });
    }
    catch (error) {
        console.error('Broadcast Push Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.broadcastPushNotification = broadcastPushNotification;
const changeUserPassword = async (req, res) => {
    try {
        const id = req.params.id;
        const { newPassword } = req.body;
        if (!newPassword || newPassword.trim() === '') {
            res.status(400).json({ error: 'New password is required' });
            return;
        }
        if (newPassword.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 10);
        await db_1.prisma.user.update({
            where: { id },
            data: { passwordHash }
        });
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'CHANGE_USER_PASSWORD', { userId: id, phone: user.phoneNumber }, ip);
        res.status(200).json({ success: true, message: 'Password changed successfully' });
    }
    catch (error) {
        console.error('Change User Password Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.changeUserPassword = changeUserPassword;
const triggerReferralDistribution = async (req, res) => {
    try {
        await (0, network_service_1.distributePendingReferralCommissions)();
        const adminId = req.admin?.adminId || 'unknown-id';
        const adminName = req.admin?.username || 'unknown-admin';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'TRIGGER_REFERRAL_DISTRIBUTION', {}, ip);
        res.status(200).json({ success: true, message: 'Referral distribution processed successfully.' });
    }
    catch (error) {
        console.error('Trigger Referral Distribution Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.triggerReferralDistribution = triggerReferralDistribution;
const getAuditLogs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const auditLogs = await db_1.prisma.adminAuditLog.findMany({
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit
        });
        const total = await db_1.prisma.adminAuditLog.count();
        res.status(200).json({
            success: true,
            auditLogs,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (error) {
        console.error('Get Audit Logs Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getAuditLogs = getAuditLogs;
