"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.replySupportTicket = exports.getSupportTickets = exports.updateWithdrawalStatus = exports.getWithdrawals = exports.deleteUser = exports.updateUserBalance = exports.getUsers = exports.updateConfigs = exports.getConfigs = exports.getDashboardStats = exports.loginAdmin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
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
            recentTransactions
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
        const configData = req.body;
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
        // We should delete user dependencies first
        await db_1.prisma.transaction.deleteMany({ where: { userId: id } });
        await db_1.prisma.dailyUsage.deleteMany({ where: { userId: id } });
        await db_1.prisma.referralReward.deleteMany({ where: { userId: id } });
        await db_1.prisma.notification.deleteMany({ where: { userId: id } });
        await db_1.prisma.supportTicket.deleteMany({ where: { userId: id } });
        await db_1.prisma.user.delete({ where: { id } });
        res.status(200).json({ success: true, message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.deleteUser = deleteUser;
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
const updateWithdrawalStatus = async (req, res) => {
    try {
        const id = req.params.id;
        const { status, referenceId } = req.body; // status: 'success' or 'failed'
        if (!['success', 'failed'].includes(status)) {
            res.status(400).json({ error: 'Invalid status. Must be success or failed' });
            return;
        }
        const tx = await db_1.prisma.transaction.findUnique({
            where: { id },
            include: { user: true }
        });
        if (!tx || tx.type !== 'withdrawal') {
            res.status(404).json({ error: 'Withdrawal request not found' });
            return;
        }
        if (tx.status !== 'pending') {
            res.status(400).json({ error: 'Withdrawal request is already processed' });
            return;
        }
        const updatedTx = await db_1.prisma.$transaction(async (prismaTx) => {
            // 1. Update transaction status
            const updated = await prismaTx.transaction.update({
                where: { id },
                data: {
                    status,
                    description: status === 'success'
                        ? `Withdrawal Successful. Ref ID: ${referenceId || 'N/A'}`
                        : 'Withdrawal Rejected/Failed.'
                }
            });
            // 2. If failed, refund the amount back to user's wallet
            if (status === 'failed') {
                await prismaTx.user.update({
                    where: { id: tx.userId },
                    data: {
                        balance: { increment: Math.abs(tx.amount) } // tx.amount is stored negative e.g. -500
                    }
                });
            }
            else if (status === 'success') {
                // Increment withdrawalAmount stats
                await prismaTx.user.update({
                    where: { id: tx.userId },
                    data: {
                        withdrawalAmount: { increment: Math.abs(tx.amount) }
                    }
                });
            }
            return updated;
        });
        // Create a notification for the user
        await db_1.prisma.notification.create({
            data: {
                userId: tx.userId,
                title: status === 'success' ? 'Withdrawal Approved 💰' : 'Withdrawal Failed ❌',
                body: status === 'success'
                    ? `Your withdrawal of ${Math.abs(tx.amount)} coins is successful. Ref: ${referenceId || 'N/A'}`
                    : `Your withdrawal of ${Math.abs(tx.amount)} coins was rejected. Coins refunded to wallet.`,
                type: 'withdrawal'
            }
        });
        res.status(200).json({ success: true, message: 'Withdrawal status updated', transaction: updatedTx });
    }
    catch (error) {
        console.error('Update Withdrawal Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateWithdrawalStatus = updateWithdrawalStatus;
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
        // Notify user in-app
        await db_1.prisma.notification.create({
            data: {
                userId: ticket.userId,
                title: 'Support Ticket Reply ✉️',
                body: `Support team replied to your ticket: "${reply.substring(0, 40)}..."`,
                type: 'alert'
            }
        });
        res.status(200).json({ success: true, message: 'Reply sent and ticket resolved', ticket: updatedTicket });
    }
    catch (error) {
        console.error('Reply Ticket Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.replySupportTicket = replySupportTicket;
