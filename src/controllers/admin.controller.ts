import { Request, Response } from 'express';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

// 1. Admin Login
export const loginAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { adminId: admin.id, role: admin.role, username: admin.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 2. Get Dashboard Stats
export const getDashboardStats = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const totalUsers = await prisma.user.count();
    
    // Sum of user balances
    const userBalances = await prisma.user.aggregate({
      _sum: {
        balance: true,
        referralBalance: true,
        totalEarned: true,
        withdrawalAmount: true,
      }
    });

    // Count of pending withdrawals (transactions of type 'withdrawal' with 'pending' status)
    const pendingWithdrawalsCount = await prisma.transaction.count({
      where: { type: 'withdrawal', status: 'pending' }
    });

    // Sum of total paid/success withdrawals
    const totalWithdrawnAmount = await prisma.transaction.aggregate({
      where: { type: 'withdrawal', status: 'success' },
      _sum: { amount: true }
    });

    // Count of open support tickets (status 'pending' or 'in_progress')
    const openTicketsCount = await prisma.supportTicket.count({
      where: { status: { in: ['pending', 'in_progress'] } }
    });

    // Recent 10 transactions
    const recentTransactions = await prisma.transaction.findMany({
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
  } catch (error) {
    console.error('Get Stats Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 3. Configurations
export const getConfigs = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    let config = await prisma.appConfig.findFirst();
    if (!config) {
      // Fallback fallback seed
      config = await prisma.appConfig.create({ data: {} });
    }
    res.status(200).json({ success: true, config });
  } catch (error) {
    console.error('Get Configs Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateConfigs = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id, createdAt, updatedAt, latestVersion, updateUrl, ...configData } = req.body;
    let config = await prisma.appConfig.findFirst();

    if (!config) {
      config = await prisma.appConfig.create({ data: configData });
    } else {
      config = await prisma.appConfig.update({
        where: { id: config.id },
        data: configData
      });
    }

    res.status(200).json({ success: true, message: 'Configuration updated successfully', config });
  } catch (error) {
    console.error('Update Configs Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 4. User Management
export const getUsers = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = {};
    if (search) {
      where.OR = [
        { phoneNumber: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { referralCode: { contains: search, mode: 'insensitive' } }
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.user.count({ where });

    res.status(200).json({
      success: true,
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get Users Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUserBalance = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { balance, type } = req.body; // type can be 'add' or 'set'

    if (balance === undefined) {
       res.status(400).json({ error: 'Balance value is required' });
       return;
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
       res.status(404).json({ error: 'User not found' });
       return;
    }

    let finalBalance = balance;
    if (type === 'add') {
      finalBalance = user.balance + balance;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        balance: finalBalance,
        totalEarned: type === 'add' && balance > 0 ? user.totalEarned + balance : user.totalEarned
      }
    });

    // Create a transaction record for auditing
    await prisma.transaction.create({
      data: {
        userId: id,
        amount: type === 'add' ? balance : (balance - user.balance),
        type: 'bonus',
        status: 'success',
        description: 'Admin balance adjustment',
      }
    });

    res.status(200).json({ success: true, message: 'User balance updated', user: updatedUser });
  } catch (error) {
    console.error('Update Balance Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteUser = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    // We should delete user dependencies first
    await prisma.transaction.deleteMany({ where: { userId: id } });
    await prisma.dailyUsage.deleteMany({ where: { userId: id } });
    await prisma.referralReward.deleteMany({ where: { userId: id } });
    await prisma.notification.deleteMany({ where: { userId: id } });
    await prisma.supportTicket.deleteMany({ where: { userId: id } });

    await prisma.user.delete({ where: { id } });

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 5. Withdrawal Requests Management
export const getWithdrawals = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || ''; // pending, success, failed
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = { type: 'withdrawal' };
    if (status) {
      where.status = status;
    }

    const withdrawals = await prisma.transaction.findMany({
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

    const total = await prisma.transaction.count({ where });

    res.status(200).json({
      success: true,
      withdrawals,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get Withdrawals Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateWithdrawalStatus = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, referenceId } = req.body; // status: 'success' or 'failed'

    if (!['success', 'failed'].includes(status)) {
       res.status(400).json({ error: 'Invalid status. Must be success or failed' });
       return;
    }

    const tx = await prisma.transaction.findUnique({
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

    const updatedTx = await prisma.$transaction(async (prismaTx) => {
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
        const refundAmount = Math.abs(tx.amount);
        console.log(`[WITHDRAWAL REJECT] Refunding ${refundAmount} coins to user ID: ${tx.userId}`);
        await prismaTx.user.update({
          where: { id: tx.userId },
          data: {
            balance: { increment: refundAmount }
          }
        });
      } else if (status === 'success') {
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
    await prisma.notification.create({
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
  } catch (error) {
    console.error('Update Withdrawal Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 6. Support Tickets Management
export const getSupportTickets = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || ''; // pending, resolved
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const tickets = await prisma.supportTicket.findMany({
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

    const total = await prisma.supportTicket.count({ where });

    res.status(200).json({
      success: true,
      tickets,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get Support Tickets Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const replySupportTicket = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reply } = req.body;

    if (!reply || reply.trim() === '') {
       res.status(400).json({ error: 'Reply message is required' });
       return;
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
       res.status(404).json({ error: 'Ticket not found' });
       return;
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id },
      data: {
        reply,
        status: 'resolved'
      }
    });

    // Notify user in-app
    await prisma.notification.create({
      data: {
        userId: ticket.userId,
        title: 'Support Ticket Reply ✉️',
        body: `Support team replied to your ticket: "${reply.substring(0, 40)}..."`,
        type: 'alert'
      }
    });

    res.status(200).json({ success: true, message: 'Reply sent and ticket resolved', ticket: updatedTicket });
  } catch (error) {
    console.error('Reply Ticket Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
