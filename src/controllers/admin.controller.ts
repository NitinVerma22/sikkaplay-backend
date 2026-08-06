import { Request, Response } from 'express';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { sendPushNotification, sendPushNotificationBatch } from '../services/push.service';
import { distributePendingReferralCommissions } from '../services/network.service';
import { logAdminAction } from '../services/audit.service';
import { invalidateConfigCache } from '../services/config.service';
import { auth as firebaseAuth } from '../config/firebase';

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

    // --- REAL-TIME TIME-SERIES STATS FOR CHARTS ---
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); // Go back 5 months + current month = 6 months
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const financeTxs = await prisma.transaction.findMany({
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

    const newUsers = await prisma.user.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo }
      },
      select: {
        createdAt: true
      }
    });

    const monthsList: { name: string; dateStart: Date; dateEnd: Date; earnings: number; withdrawals: number; users: number }[] = [];
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
          } else {
            m.earnings += tx.amount;
          }
          break;
        }
      }
    }

    let runningUserCount = await prisma.user.count({
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

    // Invalidate configuration cache to refresh it on the next fetch
    invalidateConfigCache();

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'UPDATE_CONFIG', configData, ip);

    res.status(200).json({ success: true, message: 'Configuration updated successfully', config });
  } catch (error) {
    console.error('Update Configs Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 4. User Management
export const getUsers = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const filter = (req.query.filter as string) || 'all';
    const search = (req.query.search as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = {};
    
    if (filter === 'deleted') {
      where.name = 'Deleted User';
    } else if (filter === 'active') {
      where.isBlocked = false;
      where.NOT = {
        name: 'Deleted User'
      };
    } else if (filter === 'blocked') {
      where.isBlocked = true;
      where.NOT = {
        name: 'Deleted User'
      };
    }

    if (search) {
      where.AND = [
        ...(where.NOT ? [ { NOT: where.NOT } ] : []),
        ...(where.name ? [ { name: where.name } ] : []),
        ...(where.isBlocked !== undefined ? [ { isBlocked: where.isBlocked } ] : []),
        {
          OR: [
            { phoneNumber: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { referralCode: { contains: search, mode: 'insensitive' } }
          ]
        }
      ];
      // Clean up the top-level keys if we moved them to AND
      delete where.NOT;
      delete where.name;
      delete where.isBlocked;
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

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'ADJUST_BALANCE',
      {
        userId: id,
        userPhone: user.phoneNumber,
        actionType: type,
        amount: balance,
        oldBalance: user.balance,
        newBalance: finalBalance
      },
      ip
    );

    res.status(200).json({ success: true, message: 'User balance updated', user: updatedUser });
  } catch (error) {
    console.error('Update Balance Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteUser = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    // Fetch user details first to get firebaseUid
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Delete user from Firebase Auth if exists
    if (user.firebaseUid) {
      try {
        await firebaseAuth.deleteUser(user.firebaseUid);
        console.log(`Successfully deleted user ${user.firebaseUid} from Firebase Auth`);
      } catch (fbError) {
        console.warn(`Firebase Auth user deletion failed or user not found:`, fbError);
      }
    }

    // We should delete user dependencies first to satisfy foreign key constraints
    await prisma.transaction.deleteMany({ where: { userId: id } });
    await prisma.dailyUsage.deleteMany({ where: { userId: id } });
    await prisma.referralReward.deleteMany({ where: { userId: id } });
    await prisma.notification.deleteMany({ where: { userId: id } });
    await prisma.supportTicket.deleteMany({ where: { userId: id } });
    await prisma.visitEarnClaim.deleteMany({ where: { userId: id } });
    await prisma.dailyCodeClaim.deleteMany({ where: { userId: id } });
    await prisma.gameSession.deleteMany({ where: { userId: id } });
    await prisma.adImpression.deleteMany({ where: { userId: id } });

    await prisma.user.delete({ where: { id } });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'DELETE_USER', { userId: id }, ip);

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Delete User Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const bulkDeleteUsers = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'Missing or invalid userIds array' });
      return;
    }

    // Fetch firebaseUids of all these users
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { firebaseUid: true }
    });

    // Delete from Firebase Auth in parallel/batch
    for (const u of users) {
      if (u.firebaseUid) {
        try {
          await firebaseAuth.deleteUser(u.firebaseUid);
        } catch (fbError) {
          console.warn(`Firebase Auth bulk deletion: user ${u.firebaseUid} failed or not found:`, fbError);
        }
      }
    }

    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.dailyUsage.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.referralReward.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.supportTicket.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.visitEarnClaim.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.dailyCodeClaim.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.gameSession.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.adImpression.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'BULK_DELETE_USERS', { userIds }, ip);

    res.status(200).json({ success: true, message: `${userIds.length} users deleted successfully` });
  } catch (error: any) {
    console.error('Bulk Delete Users Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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

const processWithdrawal = async (
  txId: string,
  status: 'success' | 'failed',
  referenceId?: string,
  adminId: string = 'unknown-id',
  adminName: string = 'unknown-admin',
  ipAddress?: string
) => {
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { user: true }
  });

  if (!tx || tx.type !== 'withdrawal') {
    throw new Error(`Withdrawal request ${txId} not found`);
  }

  if (tx.status !== 'pending') {
    throw new Error(`Withdrawal request ${txId} is already processed`);
  }

  const updatedTx = await prisma.$transaction(async (prismaTx) => {
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
  const targetUser = await prisma.user.findUnique({
    where: { id: tx.userId },
    select: { fcmToken: true }
  });

  const notifTitle = status === 'success' ? 'Withdrawal Approved 💰' : 'Withdrawal Failed ❌';
  const notifBody = status === 'success'
    ? `Your withdrawal of ${Math.abs(tx.amount)} coins is successful. Ref: ${referenceId || 'N/A'}`
    : `Your withdrawal of ${Math.abs(tx.amount)} coins was rejected. Coins refunded to wallet.`;

  if (targetUser?.fcmToken) {
    await sendPushNotification(targetUser.fcmToken, notifTitle, notifBody, 'withdrawal', null, tx.userId);
  } else {
    await prisma.notification.create({
      data: {
        userId: tx.userId,
        title: notifTitle,
        body: notifBody,
        type: 'withdrawal'
      }
    });
  }

  await logAdminAction(
    adminId,
    adminName,
    'PROCESS_WITHDRAWAL',
    {
      transactionId: txId,
      userId: tx.userId,
      userPhone: tx.user.phoneNumber,
      amount: tx.amount,
      status,
      referenceId
    },
    ipAddress
  );

  return updatedTx;
};

export const updateWithdrawalStatus = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, referenceId } = req.body; // status: 'success' or 'failed'

    if (!['success', 'failed'].includes(status)) {
       res.status(400).json({ error: 'Invalid status. Must be success or failed' });
       return;
    }

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    const updatedTx = await processWithdrawal(id, status, referenceId, adminId, adminName, ip);
    res.status(200).json({ success: true, message: 'Withdrawal status updated', transaction: updatedTx });
  } catch (error: any) {
    console.error('Update Withdrawal Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const bulkUpdateWithdrawalStatus = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, status, referenceId } = req.body; // ids: 'all_pending' | string[], status: 'success' | 'failed'

    if (!['success', 'failed'].includes(status)) {
       res.status(400).json({ error: 'Invalid status. Must be success or failed' });
       return;
    }

    let targetIds: string[] = [];

    if (ids === 'all_pending') {
      const pendingTxs = await prisma.transaction.findMany({
        where: { type: 'withdrawal', status: 'pending' },
        select: { id: true }
      });
      targetIds = pendingTxs.map(t => t.id);
    } else if (Array.isArray(ids)) {
      targetIds = ids;
    } else {
      res.status(400).json({ error: 'ids must be "all_pending" or an array of strings' });
      return;
    }

    if (targetIds.length === 0) {
      res.status(200).json({ success: true, message: 'No withdrawals to process' });
      return;
    }

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    const results = [];
    const errors = [];

    for (const id of targetIds) {
      try {
        const updated = await processWithdrawal(id, status, referenceId, adminId, adminName, ip);
        results.push(updated);
      } catch (err: any) {
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
  } catch (error: any) {
    console.error('Bulk Update Withdrawal Error:', error);
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

    // Notify user via push notification
    let ticketUser = null;
    if (ticket.userId) {
      ticketUser = await prisma.user.findUnique({
        where: { id: ticket.userId },
        select: { fcmToken: true }
      });
    }

    const ticketNotifTitle = 'Support Ticket Reply ✉️';
    const ticketNotifBody = `Support team replied to your ticket: "${reply.substring(0, 40)}..."`;

    if (ticketUser?.fcmToken) {
      await sendPushNotification(ticketUser.fcmToken, ticketNotifTitle, ticketNotifBody, 'alert', null, ticket.userId || undefined);
    } else if (ticket.userId) {
      await prisma.notification.create({
        data: {
          userId: ticket.userId,
          title: ticketNotifTitle,
          body: ticketNotifBody,
          type: 'alert'
        }
      });
    }

    res.status(200).json({ success: true, message: 'Reply sent and ticket resolved', ticket: updatedTicket });
  } catch (error) {
    console.error('Reply Ticket Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const toggleUserFreeze = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isBlocked: !user.isBlocked }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'TOGGLE_FREEZE_USER',
      { userId: id, phone: user.phoneNumber, newFreezeState: updatedUser.isBlocked },
      ip
    );

    res.status(200).json({ success: true, isBlocked: updatedUser.isBlocked });
  } catch (error) {
    console.error('Toggle User Freeze Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const broadcastPushNotification = async (req: AdminAuthRequest, res: Response): Promise<void> => {
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

      const user = await prisma.user.findUnique({
        where: { phoneNumber: formattedPhone },
        select: { id: true, fcmToken: true }
      });

      if (!user) {
        res.status(404).json({ error: 'User with this phone number not found' });
        return;
      }

      if (user.fcmToken) {
        await sendPushNotification(user.fcmToken, title, body, notificationType, bannerUrl, user.id);
      } else {
        await prisma.notification.create({
          data: {
            userId: user.id,
            title,
            body,
            type: notificationType,
            bannerUrl: bannerUrl || null,
          }
        });
      }
    } else {
      let whereClause: any = {};

      if (targetType === 'inactive_2_days') {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        whereClause.updatedAt = { lt: twoDaysAgo };
      } else if (targetType === 'inactive_7_days') {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        whereClause.updatedAt = { lt: sevenDaysAgo };
      } else if (targetType === 'zero_balance') {
        whereClause.balance = 0;
      }

      const users = await prisma.user.findMany({
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
        await prisma.notification.createMany({ data: dbEntries });
      }

      // Send push notifications in batches via FCM
      const usersWithToken = users.filter(u => u.fcmToken);
      const tokens = usersWithToken.map(u => u.fcmToken!);
      if (tokens.length > 0) {
        await sendPushNotificationBatch(tokens, title, body, notificationType, bannerUrl);
      }
    }

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'BROADCAST_NOTIFICATION',
      { title, type, targetType, phoneNumber },
      ip
    );

    res.status(200).json({ success: true, message: 'Notifications sent successfully' });
  } catch (error) {
    console.error('Broadcast Push Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const changeUserPassword = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.trim() === '') {
      res.status(400).json({ error: 'New password is required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id },
      data: { passwordHash }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'CHANGE_USER_PASSWORD',
      { userId: id, phone: user.phoneNumber },
      ip
    );

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change User Password Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const triggerReferralDistribution = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    await distributePendingReferralCommissions();

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'TRIGGER_REFERRAL_DISTRIBUTION', {}, ip);

    res.status(200).json({ success: true, message: 'Referral distribution processed successfully.' });
  } catch (error) {
    console.error('Trigger Referral Distribution Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAuditLogs = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const auditLogs = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });

    const total = await prisma.adminAuditLog.count();

    res.status(200).json({
      success: true,
      auditLogs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get Audit Logs Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAdAnalysisStats = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    // 1. General counts
    const totalImpressions = await prisma.adImpression.count({ where });
    
    // Group by adType (counts and sum of coins)
    const statsByType = await prisma.adImpression.groupBy({
      where,
      by: ['adType'],
      _count: { id: true },
      _sum: { coinsAwarded: true }
    });

    // Group by adNetwork
    const statsByNetwork = await prisma.adImpression.groupBy({
      where,
      by: ['adNetwork'],
      _count: { id: true }
    });

    // 2. Count unique users for each group
    const distinctUsersAnyAd = await prisma.adImpression.findMany({
      where,
      select: { userId: true },
      distinct: ['userId']
    });
    const uniqueUsersCount = distinctUsersAnyAd.length;

    // Distinct users for rewarded ads (adType containing 'rewarded')
    const distinctUsersRewarded = await prisma.adImpression.findMany({
      where: {
        ...where,
        adType: { contains: 'rewarded', mode: 'insensitive' }
      },
      select: { userId: true },
      distinct: ['userId']
    });
    const uniqueUsersRewardedCount = distinctUsersRewarded.length;

    // Distinct users for banners
    const distinctUsersBanner = await prisma.adImpression.findMany({
      where: {
        ...where,
        adType: { contains: 'banner', mode: 'insensitive' }
      },
      select: { userId: true },
      distinct: ['userId']
    });
    const uniqueUsersBannerCount = distinctUsersBanner.length;

    // Distinct users for interstitials
    const distinctUsersInterstitial = await prisma.adImpression.findMany({
      where: {
        ...where,
        adType: { contains: 'interstitial', mode: 'insensitive' }
      },
      select: { userId: true },
      distinct: ['userId']
    });
    const uniqueUsersInterstitialCount = distinctUsersInterstitial.length;

    // 3. Time series stats (daily stats)
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 14);
    defaultStart.setHours(0, 0, 0, 0);

    const timeSeriesStart = startDate ? new Date(startDate as string) : defaultStart;
    const timeSeriesEnd = endDate ? new Date(endDate as string) : new Date();

    const impressionsForChart = await prisma.adImpression.findMany({
      where: {
        createdAt: {
          gte: timeSeriesStart,
          lte: timeSeriesEnd
        }
      },
      select: {
        adType: true,
        createdAt: true
      }
    });

    // Group impressions by day and adType (rewarded, banner, interstitial)
    const dailyDataMap: { [dateStr: string]: { date: string; rewarded: number; banner: number; interstitial: number; total: number } } = {};
    
    // Initialize dates in range
    const temp = new Date(timeSeriesStart);
    while (temp <= timeSeriesEnd) {
      const dateStr = temp.toISOString().split('T')[0];
      dailyDataMap[dateStr] = { date: dateStr, rewarded: 0, banner: 0, interstitial: 0, total: 0 };
      temp.setDate(temp.getDate() + 1);
    }
    // Also make sure today is added if not there
    const todayStr = new Date().toISOString().split('T')[0];
    if (!dailyDataMap[todayStr]) {
      dailyDataMap[todayStr] = { date: todayStr, rewarded: 0, banner: 0, interstitial: 0, total: 0 };
    }

    for (const imp of impressionsForChart) {
      const dateStr = imp.createdAt.toISOString().split('T')[0];
      if (dailyDataMap[dateStr]) {
        dailyDataMap[dateStr].total++;
        const type = imp.adType.toLowerCase();
        if (type.includes('rewarded')) {
          dailyDataMap[dateStr].rewarded++;
        } else if (type.includes('banner')) {
          dailyDataMap[dateStr].banner++;
        } else if (type.includes('interstitial')) {
          dailyDataMap[dateStr].interstitial++;
        }
      }
    }

    const dailyStats = Object.values(dailyDataMap).sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      summary: {
        totalImpressions,
        uniqueUsersCount,
        uniqueUsersRewardedCount,
        uniqueUsersBannerCount,
        uniqueUsersInterstitialCount
      },
      statsByType,
      statsByNetwork,
      dailyStats
    });
  } catch (error) {
    console.error('Get Ad Analysis Stats Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getModerators = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const moderators = await prisma.admin.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, moderators });
  } catch (error) {
    console.error('Get Moderators Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createModerator = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      res.status(400).json({ error: 'Username, password and role are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const existingAdmin = await prisma.admin.findUnique({
      where: { username: username.trim() }
    });

    if (existingAdmin) {
      res.status(400).json({ error: 'Username is already taken' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = await prisma.admin.create({
      data: {
        username: username.trim(),
        password: hashedPassword,
        role: role
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true
      }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'CREATE_MODERATOR',
      { createdUsername: newAdmin.username, role: newAdmin.role },
      ip
    );

    res.status(201).json({ success: true, moderator: newAdmin });
  } catch (error) {
    console.error('Create Moderator Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteModerator = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const moderator = await prisma.admin.findUnique({ where: { id } });
    if (!moderator) {
      res.status(404).json({ error: 'Moderator account not found' });
      return;
    }

    // Prevent deleting oneself
    if (id === req.admin?.adminId) {
      res.status(400).json({ error: 'You cannot delete your own admin account' });
      return;
    }

    await prisma.admin.delete({ where: { id } });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'DELETE_MODERATOR',
      { deletedId: id, deletedUsername: moderator.username },
      ip
    );

    res.status(200).json({ success: true, message: 'Moderator account deleted successfully' });
  } catch (error) {
    console.error('Delete Moderator Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMultiAccountFraudGroups = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const deviceGroups = await prisma.$queryRaw<any[]>`
      SELECT "deviceId", COUNT(id) as "userCount"
      FROM "User"
      WHERE "deviceId" IS NOT NULL AND "deviceId" != ''
      GROUP BY "deviceId"
      HAVING COUNT(id) > 1
      ORDER BY "userCount" DESC
    `;

    const groups = [];
    for (const g of deviceGroups) {
      const users = await prisma.user.findMany({
        where: { deviceId: g.deviceId },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          balance: true,
          totalEarned: true,
          isBlocked: true,
          createdAt: true
        }
      });
      groups.push({
        deviceId: g.deviceId,
        userCount: Number(g.userCount),
        users
      });
    }

    res.status(200).json({ success: true, groups });
  } catch (error) {
    console.error('Get Multi-Account Fraud Groups Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const bulkBlockUsers = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { userIds, isBlocked } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'Missing or invalid userIds array' });
      return;
    }

    const blockState = isBlocked !== false;

    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isBlocked: blockState }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(
      adminId,
      adminName,
      'BULK_BLOCK_USERS',
      { userIds, isBlocked: blockState },
      ip
    );

    res.status(200).json({ success: true, message: `Successfully updated block status for ${userIds.length} users.` });
  } catch (error) {
    console.error('Bulk Block Users Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSuspiciousGames = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const suspiciousSessions = await prisma.gameSession.findMany({
      where: {
        OR: [
          { status: 'invalidated' },
          {
            gameType: { not: 'spin' },
            coinsEarned: { gt: 80 }
          }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            name: true,
            phoneNumber: true,
            isBlocked: true
          }
        }
      }
    });

    res.status(200).json({ success: true, sessions: suspiciousSessions });
  } catch (error) {
    console.error('Get Suspicious Games Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserLedger = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const transactions = await prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    const gameSessions = await prisma.gameSession.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const dailyUsages = await prisma.dailyUsage.findMany({
      where: { userId: id },
      orderBy: { dateStr: 'desc' },
      take: 30
    });

    res.status(200).json({
      success: true,
      transactions,
      gameSessions,
      dailyUsages
    });
  } catch (error) {
    console.error('Get User Ledger Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const fetchUsersWithStatsHelper = async (codes: string[]) => {
  if (codes.length === 0) return [];
  
  const users = await prisma.user.findMany({
    where: { referredBy: { in: codes } },
    select: { id: true, name: true, createdAt: true, referralCode: true, totalEarned: true, phoneNumber: true },
  });

  if (users.length === 0) return [];

  const userIds = users.map(u => u.id);

  const playtimes = await prisma.dailyUsage.groupBy({
    by: ['userId'],
    _sum: {
      gamesMinutes: true,
    },
    where: {
      userId: { in: userIds }
    }
  });

  const playtimeMap = new Map<string, number>();
  for (const pt of playtimes) {
    const total = pt._sum.gamesMinutes ?? 0;
    playtimeMap.set(pt.userId, total);
  }

  return users.map(u => ({
    id: u.id,
    name: u.name,
    createdAt: u.createdAt,
    referralCode: u.referralCode,
    phoneNumber: u.phoneNumber,
    totalEarned: u.totalEarned,
    playtime: playtimeMap.get(u.id) ?? 0,
  }));
};

export const getUserNetwork = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { referralCode: true, referralBalance: true, name: true, phoneNumber: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const level1 = await fetchUsersWithStatsHelper([user.referralCode]);
    const level1Codes = level1.map(u => u.referralCode);

    const level2 = await fetchUsersWithStatsHelper(level1Codes);
    const level2Codes = level2.map(u => u.referralCode);

    const level3 = await fetchUsersWithStatsHelper(level2Codes);

    res.status(200).json({
      success: true,
      referralCode: user.referralCode,
      referralBalance: user.referralBalance,
      network: {
        level1,
        level2,
        level3,
        totalTeam: level1.length + level2.length + level3.length,
      }
    });
  } catch (error) {
    console.error('Get User Network Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAdminFaqs = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const faqs = await prisma.fAQ.findMany();
    res.status(200).json({ success: true, faqs });
  } catch (error) {
    console.error('Get Admin FAQs Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createAdminFaq = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { question, answer } = req.body;

    if (!question || !answer) {
      res.status(400).json({ error: 'Question and answer are required' });
      return;
    }

    const faq = await prisma.fAQ.create({
      data: { question, answer }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'CREATE_FAQ', { faqId: faq.id, question: faq.question }, ip);

    res.status(201).json({ success: true, faq });
  } catch (error) {
    console.error('Create Admin FAQ Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateAdminFaq = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { question, answer } = req.body;

    const existingFaq = await prisma.fAQ.findUnique({ where: { id } });
    if (!existingFaq) {
      res.status(404).json({ error: 'FAQ not found' });
      return;
    }

    const faq = await prisma.fAQ.update({
      where: { id },
      data: { question, answer }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'UPDATE_FAQ', { faqId: faq.id, question: faq.question }, ip);

    res.status(200).json({ success: true, faq });
  } catch (error) {
    console.error('Update Admin FAQ Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteAdminFaq = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const existingFaq = await prisma.fAQ.findUnique({ where: { id } });
    if (!existingFaq) {
      res.status(404).json({ error: 'FAQ not found' });
      return;
    }

    await prisma.fAQ.delete({ where: { id } });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'DELETE_FAQ', { faqId: id, question: existingFaq.question }, ip);

    res.status(200).json({ success: true, message: 'FAQ deleted successfully' });
  } catch (error) {
    console.error('Delete Admin FAQ Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const clearUserDevice = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const oldDeviceId = user.deviceId;

    // Update user deviceId to null
    await prisma.user.update({
      where: { id },
      data: { deviceId: null }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'CLEAR_USER_DEVICE', { userId: id, oldDeviceId }, ip);

    res.status(200).json({ success: true, message: 'Device ID cleared successfully' });
  } catch (error: any) {
    console.error('Clear User Device Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const bulkClearAllDeviceData = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const result = await prisma.user.updateMany({
      data: { deviceId: null }
    });

    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    await logAdminAction(adminId, adminName, 'BULK_CLEAR_ALL_DEVICE_DATA', { clearedCount: result.count }, ip);

    res.status(200).json({ success: true, message: `Device data cleared successfully for ${result.count} users.`, clearedCount: result.count });
  } catch (error: any) {
    console.error('Bulk Clear Device Data Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};





