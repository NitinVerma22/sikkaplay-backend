import { Router } from 'express';
import {
  loginAdmin,
  getDashboardStats,
  getConfigs,
  updateConfigs,
  getUsers,
  updateUserBalance,
  deleteUser,
  bulkDeleteUsers,
  clearUserDevice,
  getWithdrawals,
  updateWithdrawalStatus,
  bulkUpdateWithdrawalStatus,
  getSupportTickets,
  replySupportTicket,
  toggleUserFreeze,
  broadcastPushNotification,
  changeUserPassword,
  triggerReferralDistribution,
  getAuditLogs,
  getAdAnalysisStats,
  getModerators,
  createModerator,
  deleteModerator,
  getMultiAccountFraudGroups,
  bulkBlockUsers,
  getSuspiciousGames,
  getUserLedger,
  getUserNetwork,
  getAdminFaqs,
  createAdminFaq,
  updateAdminFaq,
  deleteAdminFaq
} from '../controllers/admin.controller';
import { requireAdminJwt, requireRole } from '../middleware/adminAuth.middleware';
import { createDailyCode, getDailyCodes } from '../controllers/dailyCode.controller';
import { createVisitLink, getVisitLinks, deleteVisitLink } from '../controllers/visitLink.controller';
import {
  getSocialTasksAdmin,
  createSocialTaskAdmin,
  updateSocialTaskAdmin,
  deleteSocialTaskAdmin
} from '../controllers/socialTask.controller';
import {
  getCleanableTables,
  previewMaintenanceRecords,
  exportMaintenanceRecords,
  cleanupMaintenanceRecords
} from '../controllers/maintenance.controller';

const router = Router();

// Public route for Admin login
router.post('/login', loginAdmin);

// Protect all other routes with admin JWT validation
router.use(requireAdminJwt);

// Stats & Dashboard Overview
router.get('/stats', getDashboardStats);
router.get('/ad-stats', getAdAnalysisStats);
router.post('/referrals/distribute', triggerReferralDistribution);
router.get('/audit-logs', requireRole(['superadmin']), getAuditLogs);

// Moderator/Admin Management
router.get('/moderators', requireRole(['superadmin']), getModerators);
router.post('/moderators', requireRole(['superadmin']), createModerator);
router.delete('/moderators/:id', requireRole(['superadmin']), deleteModerator);

// Fraud Detection Radar
router.get('/fraud/multi-accounts', getMultiAccountFraudGroups);
router.post('/fraud/bulk-block', requireRole(['superadmin']), bulkBlockUsers);
router.get('/fraud/suspicious-games', getSuspiciousGames);

// App Config Settings
router.get('/config', getConfigs);
router.put('/config', requireRole(['superadmin']), updateConfigs);

// User Management
router.get('/users', getUsers);
router.get('/users/:id/ledger', getUserLedger);
router.get('/users/:id/network', getUserNetwork);
router.put('/users/:id/balance', updateUserBalance);
router.put('/users/:id/freeze', toggleUserFreeze);
router.put('/users/:id/change-password', changeUserPassword);
router.delete('/users/:id', requireRole(['superadmin']), deleteUser);
router.post('/users/bulk-delete', requireRole(['superadmin']), bulkDeleteUsers);
router.post('/users/:id/clear-device', requireRole(['superadmin']), clearUserDevice);

// Push Notification Broadcast
router.post('/broadcast-push', broadcastPushNotification);

// Withdrawal Management
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id', requireRole(['superadmin']), updateWithdrawalStatus);
router.post('/withdrawals/bulk', requireRole(['superadmin']), bulkUpdateWithdrawalStatus);

// Support & FAQ Tickets Management
router.get('/tickets', getSupportTickets);
router.post('/tickets/:id/reply', replySupportTicket);

// FAQ CRUD Management
router.get('/faqs', getAdminFaqs);
router.post('/faqs', createAdminFaq);
router.put('/faqs/:id', updateAdminFaq);
router.delete('/faqs/:id', deleteAdminFaq);

// Daily Code Management
router.post('/daily-code', createDailyCode);
router.get('/daily-code', getDailyCodes);

// Visit Links Management
router.post('/visit-links', createVisitLink);
router.get('/visit-links', getVisitLinks);
router.delete('/visit-links/:id', deleteVisitLink);

// Social Tasks Management
router.get('/social-tasks', getSocialTasksAdmin);
router.post('/social-tasks', createSocialTaskAdmin);
router.put('/social-tasks/:id', updateSocialTaskAdmin);
router.delete('/social-tasks/:id', deleteSocialTaskAdmin);

// Database Maintenance Management (Super Admin only)
router.get('/maintenance/tables', requireRole(['superadmin']), getCleanableTables);
router.post('/maintenance/preview', requireRole(['superadmin']), previewMaintenanceRecords);
router.post('/maintenance/export', requireRole(['superadmin']), exportMaintenanceRecords);
router.post('/maintenance/cleanup', requireRole(['superadmin']), cleanupMaintenanceRecords);

export default router;
