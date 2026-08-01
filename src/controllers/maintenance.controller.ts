import { Response } from 'express';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';
import { logAdminAction } from '../services/audit.service';
import { auth } from '../config/firebase';

const CLEANABLE_TABLES: Record<string, { modelName: string; dateField: string }> = {
  gameSession: { modelName: 'gameSession', dateField: 'createdAt' },
  adImpression: { modelName: 'adImpression', dateField: 'createdAt' },
  visitEarnClaim: { modelName: 'visitEarnClaim', dateField: 'claimedAt' },
  notification: { modelName: 'notification', dateField: 'createdAt' },
  dailyUsage: { modelName: 'dailyUsage', dateField: 'dateStr' }
};

// Simple CSV converter helper
function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  
  for (const row of data) {
    const values = headers.map(header => {
      const val = row[header];
      const escaped = ('' + (val ?? '')).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

export const getCleanableTables = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      tables: [
        { id: 'gameSession', name: 'Game Session' },
        { id: 'adImpression', name: 'Ad Impression' },
        { id: 'visitEarnClaim', name: 'Visit-Earn Claim' },
        { id: 'notification', name: 'Notification' },
        { id: 'dailyUsage', name: 'Daily Usage' }
      ]
    });
  } catch (error) {
    console.error('Get Cleanable Tables Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const previewMaintenanceRecords = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { table, fromDate, toDate } = req.body;
    if (!table || !fromDate || !toDate) {
      res.status(400).json({ error: 'Table and Date Range are required' });
      return;
    }

    const tableConfig = CLEANABLE_TABLES[table];
    if (!tableConfig) {
      res.status(400).json({ error: 'This table is protected or invalid' });
      return;
    }

    const { modelName, dateField } = tableConfig;
    const dbClient = prisma as any;

    let where: any = {};
    if (table === 'dailyUsage') {
      const fromStr = fromDate.split('T')[0];
      const toStr = toDate.split('T')[0];
      where = { dateStr: { gte: fromStr, lte: toStr } };
    } else {
      const start = new Date(fromDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setUTCHours(23, 59, 59, 999);
      where = { [dateField]: { gte: start, lte: end } };
    }

    const count = await dbClient[modelName].count({ where });
    res.json({ success: true, count });
  } catch (error) {
    console.error('Preview Maintenance Records Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const exportMaintenanceRecords = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { table, fromDate, toDate } = req.body;
    if (!table || !fromDate || !toDate) {
      res.status(400).json({ error: 'Table and Date Range are required' });
      return;
    }

    const tableConfig = CLEANABLE_TABLES[table];
    if (!tableConfig) {
      res.status(400).json({ error: 'This table is protected or invalid' });
      return;
    }

    const { modelName, dateField } = tableConfig;
    const dbClient = prisma as any;

    let where: any = {};
    if (table === 'dailyUsage') {
      const fromStr = fromDate.split('T')[0];
      const toStr = toDate.split('T')[0];
      where = { dateStr: { gte: fromStr, lte: toStr } };
    } else {
      const start = new Date(fromDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setUTCHours(23, 59, 59, 999);
      where = { [dateField]: { gte: start, lte: end } };
    }

    // Limit retrieval size to prevent out-of-memory errors
    const records = await dbClient[modelName].findMany({
      where,
      orderBy: table === 'dailyUsage' ? { dateStr: 'asc' } : { [dateField]: 'asc' },
      take: 25000
    });

    if (records.length === 0) {
      res.status(400).json({ error: 'No records found in this date range to export' });
      return;
    }

    const csvContent = convertToCSV(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=export_${table}_${fromDate.split('T')[0]}.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export Maintenance Records Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const cleanupMaintenanceRecords = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { table, fromDate, toDate, confirmationText } = req.body;
    if (!table || !fromDate || !toDate || !confirmationText) {
      res.status(400).json({ error: 'Table, Date Range, and confirmation text are required' });
      return;
    }

    if (confirmationText !== 'CONFIRM DELETE') {
      res.status(400).json({ error: 'Safety confirmation text must match exactly "CONFIRM DELETE"' });
      return;
    }

    const tableConfig = CLEANABLE_TABLES[table];
    if (!tableConfig) {
      res.status(400).json({ error: 'This table is protected or invalid' });
      return;
    }

    const { modelName, dateField } = tableConfig;
    const dbClient = prisma as any;

    let where: any = {};
    if (table === 'dailyUsage') {
      const fromStr = fromDate.split('T')[0];
      const toStr = toDate.split('T')[0];
      where = { dateStr: { gte: fromStr, lte: toStr } };
    } else {
      const start = new Date(fromDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setUTCHours(23, 59, 59, 999);
      where = { [dateField]: { gte: start, lte: end } };
    }

    const totalToDelete = await dbClient[modelName].count({ where });
    if (totalToDelete === 0) {
      res.status(400).json({ error: 'No records found in this date range to delete' });
      return;
    }

    // Safely delete in batches of 5000 rows to prevent blocking DB
    const BATCH_SIZE = 5000;
    let deletedCount = 0;
    let recordsLeft = true;

    while (recordsLeft) {
      const ids = await dbClient[modelName].findMany({
        where,
        select: { id: true },
        take: BATCH_SIZE
      });

      if (ids.length === 0) {
        recordsLeft = false;
        break;
      }

      const idList = ids.map((r: any) => r.id);
      const deleteResult = await dbClient[modelName].deleteMany({
        where: {
          id: { in: idList }
        }
      });

      deletedCount += deleteResult.count;

      if (ids.length < BATCH_SIZE) {
        recordsLeft = false;
      }
    }

    // Log the cleanup action in AdminAuditLogs
    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    await logAdminAction(
      adminId,
      adminName,
      'DB_CLEANUP',
      `Cleaned table: ${modelName}, Range: ${fromDate.split('T')[0]} to ${toDate.split('T')[0]}, Deleted: ${deletedCount} records`,
      ip
    );

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Cleanup Maintenance Records Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const systemNuclearReset = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { confirmationText } = req.body;

    if (!confirmationText || confirmationText !== 'RESET ALL DATA') {
      res.status(400).json({ error: 'Safety confirmation text must match exactly "RESET ALL DATA"' });
      return;
    }

    // 1. Delete all users from Firebase Authentication
    let firebaseDeletedCount = 0;
    try {
      let nextPageToken;
      do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);
        const uids = listUsersResult.users.map((user) => user.uid);
        if (uids.length > 0) {
          await auth.deleteUsers(uids);
          firebaseDeletedCount += uids.length;
        }
        nextPageToken = listUsersResult.pageToken;
      } while (nextPageToken);
    } catch (fbError) {
      console.error('Firebase Auth clearing error:', fbError);
      // Log error but proceed to postgres delete
    }

    // 2. Delete all records from SikkaPlay database tables
    // Clear dependent tables first to bypass foreign key constraint violations
    await prisma.transaction.deleteMany({});
    await prisma.gameSession.deleteMany({});
    await prisma.dailyUsage.deleteMany({});
    await prisma.referralReward.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.supportTicket.deleteMany({});
    await prisma.dailyCodeClaim.deleteMany({});
    await prisma.socialTaskClaim.deleteMany({});
    await prisma.visitEarnClaim.deleteMany({});
    await prisma.adStats.deleteMany({});
    await prisma.crateProgress.deleteMany({});
    await prisma.friendship.deleteMany({});
    await prisma.blockedUser.deleteMany({});
    await prisma.hiddenChat.deleteMany({});
    await prisma.playgroundSession.deleteMany({});
    await prisma.userGiftInventory.deleteMany({});
    await prisma.giftTransaction.deleteMany({});
    await prisma.playgroundReport.deleteMany({});
    await prisma.playgroundBan.deleteMany({});
    await prisma.playgroundMessage.deleteMany({});
    await prisma.adImpression.deleteMany({});

    // 3. Now delete all users from postgres database (no foreign key constraints violated)
    const userDeleteResult = await prisma.user.deleteMany({});
    const postgresDeletedCount = userDeleteResult.count;

    // 4. Log audit log action
    const adminId = req.admin?.adminId || 'unknown-id';
    const adminName = req.admin?.username || 'unknown-admin';
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    await logAdminAction(
      adminId,
      adminName,
      'NUCLEAR_RESET',
      `Successfully executed full system reset. Firebase auth: ${firebaseDeletedCount} users deleted. Supabase/PG: ${postgresDeletedCount} users deleted (with cascaded tables).`,
      ip
    );

    res.json({
      success: true,
      message: `System reset successful! Deleted ${firebaseDeletedCount} users from Firebase Auth and ${postgresDeletedCount} users from SikkaPlay database (with all history).`
    });
  } catch (error) {
    console.error('System Nuclear Reset Error:', error);
    res.status(500).json({ error: 'Internal Server Error during nuclear reset execution' });
  }
};
