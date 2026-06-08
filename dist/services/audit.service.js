"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAdminAction = void 0;
const db_1 = require("../config/db");
/**
 * Utility to asynchronously log admin actions in the database.
 * Fail-safe: logs exceptions rather than throwing to prevent disrupting requests.
 */
const logAdminAction = async (adminId, adminName, action, details, ipAddress) => {
    try {
        const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
        await db_1.prisma.adminAuditLog.create({
            data: {
                adminId,
                adminName,
                action,
                details: detailsStr,
                ipAddress: ipAddress || null
            }
        });
        console.log(`[AUDIT LOG] ${adminName} (${action}): ${detailsStr}`);
    }
    catch (error) {
        console.error('Failed to write admin audit log:', error);
    }
};
exports.logAdminAction = logAdminAction;
