import { prisma } from '../config/db';

/**
 * Utility to asynchronously log admin actions in the database.
 * Fail-safe: logs exceptions rather than throwing to prevent disrupting requests.
 */
export const logAdminAction = async (
  adminId: string,
  adminName: string,
  action: string,
  details: object | string,
  ipAddress?: string
): Promise<void> => {
  try {
    const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        adminName,
        action,
        details: detailsStr,
        ipAddress: ipAddress || null
      }
    });
    console.log(`[AUDIT LOG] ${adminName} (${action}): ${detailsStr}`);
  } catch (error) {
    console.error('Failed to write admin audit log:', error);
  }
};
