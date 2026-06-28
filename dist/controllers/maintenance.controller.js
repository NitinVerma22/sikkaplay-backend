"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupMaintenanceRecords = exports.exportMaintenanceRecords = exports.previewMaintenanceRecords = exports.getCleanableTables = void 0;
const db_1 = require("../config/db");
const audit_service_1 = require("../services/audit.service");
const CLEANABLE_TABLES = {
    gameSession: { modelName: 'gameSession', dateField: 'createdAt' },
    adImpression: { modelName: 'adImpression', dateField: 'createdAt' },
    visitEarnClaim: { modelName: 'visitEarnClaim', dateField: 'claimedAt' },
    notification: { modelName: 'notification', dateField: 'createdAt' },
    dailyUsage: { modelName: 'dailyUsage', dateField: 'dateStr' }
};
// Simple CSV converter helper
function convertToCSV(data) {
    if (data.length === 0)
        return '';
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
const getCleanableTables = async (req, res) => {
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
    }
    catch (error) {
        console.error('Get Cleanable Tables Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
exports.getCleanableTables = getCleanableTables;
const previewMaintenanceRecords = async (req, res) => {
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
        const dbClient = db_1.prisma;
        let where = {};
        if (table === 'dailyUsage') {
            const fromStr = fromDate.split('T')[0];
            const toStr = toDate.split('T')[0];
            where = { dateStr: { gte: fromStr, lte: toStr } };
        }
        else {
            where = { [dateField]: { gte: new Date(fromDate), lte: new Date(toDate) } };
        }
        const count = await dbClient[modelName].count({ where });
        res.json({ success: true, count });
    }
    catch (error) {
        console.error('Preview Maintenance Records Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
exports.previewMaintenanceRecords = previewMaintenanceRecords;
const exportMaintenanceRecords = async (req, res) => {
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
        const dbClient = db_1.prisma;
        let where = {};
        if (table === 'dailyUsage') {
            const fromStr = fromDate.split('T')[0];
            const toStr = toDate.split('T')[0];
            where = { dateStr: { gte: fromStr, lte: toStr } };
        }
        else {
            where = { [dateField]: { gte: new Date(fromDate), lte: new Date(toDate) } };
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
    }
    catch (error) {
        console.error('Export Maintenance Records Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
exports.exportMaintenanceRecords = exportMaintenanceRecords;
const cleanupMaintenanceRecords = async (req, res) => {
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
        const dbClient = db_1.prisma;
        let where = {};
        if (table === 'dailyUsage') {
            const fromStr = fromDate.split('T')[0];
            const toStr = toDate.split('T')[0];
            where = { dateStr: { gte: fromStr, lte: toStr } };
        }
        else {
            where = { [dateField]: { gte: new Date(fromDate), lte: new Date(toDate) } };
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
            const idList = ids.map((r) => r.id);
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
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        await (0, audit_service_1.logAdminAction)(adminId, adminName, 'DB_CLEANUP', `Cleaned table: ${modelName}, Range: ${fromDate.split('T')[0]} to ${toDate.split('T')[0]}, Deleted: ${deletedCount} records`, ip);
        res.json({ success: true, deletedCount });
    }
    catch (error) {
        console.error('Cleanup Maintenance Records Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
exports.cleanupMaintenanceRecords = cleanupMaintenanceRecords;
