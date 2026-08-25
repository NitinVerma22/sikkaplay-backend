"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_controller_1 = require("../controllers/admin.controller");
const adminAuth_middleware_1 = require("../middleware/adminAuth.middleware");
const dailyCode_controller_1 = require("../controllers/dailyCode.controller");
const visitLink_controller_1 = require("../controllers/visitLink.controller");
const socialTask_controller_1 = require("../controllers/socialTask.controller");
const maintenance_controller_1 = require("../controllers/maintenance.controller");
const router = (0, express_1.Router)();
// Public route for Admin login
router.post('/login', admin_controller_1.loginAdmin);
// Protect all other routes with admin JWT validation
router.use(adminAuth_middleware_1.requireAdminJwt);
// Stats & Dashboard Overview
router.get('/stats', admin_controller_1.getDashboardStats);
router.get('/manager-stats', admin_controller_1.getManagerStats);
router.get('/ad-stats', admin_controller_1.getAdAnalysisStats);
router.post('/referrals/distribute', admin_controller_1.triggerReferralDistribution);
router.get('/audit-logs', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.getAuditLogs);
// Moderator/Admin Management
router.get('/moderators', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.getModerators);
router.post('/moderators', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.createModerator);
router.delete('/moderators/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.deleteModerator);
// Fraud Detection Radar
router.get('/fraud/multi-accounts', admin_controller_1.getMultiAccountFraudGroups);
router.post('/fraud/bulk-block', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.bulkBlockUsers);
router.get('/fraud/suspicious-games', admin_controller_1.getSuspiciousGames);
router.get('/playground/reports', admin_controller_1.getPlaygroundReports);
router.get('/playground/bans', admin_controller_1.getPlaygroundBans);
router.delete('/playground/bans/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.liftPlaygroundBan);
// App Config Settings
router.get('/config', admin_controller_1.getConfigs);
router.put('/config', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.updateConfigs);
// User Management
router.get('/users', admin_controller_1.getUsers);
router.get('/users/:id/ledger', admin_controller_1.getUserLedger);
router.get('/users/:id/network', admin_controller_1.getUserNetwork);
router.put('/users/:id/balance', admin_controller_1.updateUserBalance);
router.put('/users/:id/freeze', admin_controller_1.toggleUserFreeze);
router.put('/users/:id/change-password', admin_controller_1.changeUserPassword);
router.delete('/users/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.deleteUser);
router.post('/users/bulk-delete', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.bulkDeleteUsers);
router.post('/users/:id/clear-device', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.clearUserDevice);
router.post('/users/bulk-clear-device-data', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.bulkClearAllDeviceData);
// Push Notification Broadcast
router.post('/broadcast-push', admin_controller_1.broadcastPushNotification);
// Withdrawal Management
router.get('/withdrawals', admin_controller_1.getWithdrawals);
router.put('/withdrawals/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.updateWithdrawalStatus);
router.post('/withdrawals/bulk', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.bulkUpdateWithdrawalStatus);
// Withdrawal Options Management (CRUD)
router.get('/withdrawal-options', admin_controller_1.getWithdrawalOptionsAdmin);
router.post('/withdrawal-options', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.createWithdrawalOptionAdmin);
router.put('/withdrawal-options/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.updateWithdrawalOptionAdmin);
router.delete('/withdrawal-options/:id', (0, adminAuth_middleware_1.requireRole)(['superadmin']), admin_controller_1.deleteWithdrawalOptionAdmin);
// Support & FAQ Tickets Management
router.get('/tickets', admin_controller_1.getSupportTickets);
router.post('/tickets/:id/reply', admin_controller_1.replySupportTicket);
// FAQ CRUD Management
router.get('/faqs', admin_controller_1.getAdminFaqs);
router.post('/faqs', admin_controller_1.createAdminFaq);
router.put('/faqs/:id', admin_controller_1.updateAdminFaq);
router.delete('/faqs/:id', admin_controller_1.deleteAdminFaq);
// Daily Code Management
router.post('/daily-code', dailyCode_controller_1.createDailyCode);
router.get('/daily-code', dailyCode_controller_1.getDailyCodes);
router.put('/daily-code/:id', dailyCode_controller_1.updateDailyCode);
router.delete('/daily-code/:id', dailyCode_controller_1.deleteDailyCode);
// Visit Links Management
router.post('/visit-links', visitLink_controller_1.createVisitLink);
router.get('/visit-links', visitLink_controller_1.getVisitLinks);
router.put('/visit-links/:id', visitLink_controller_1.updateVisitLink);
router.delete('/visit-links/:id', visitLink_controller_1.deleteVisitLink);
// Social Tasks Management
router.get('/social-tasks', socialTask_controller_1.getSocialTasksAdmin);
router.post('/social-tasks', socialTask_controller_1.createSocialTaskAdmin);
router.put('/social-tasks/:id', socialTask_controller_1.updateSocialTaskAdmin);
router.delete('/social-tasks/:id', socialTask_controller_1.deleteSocialTaskAdmin);
router.post('/transactions/:id/revert', admin_controller_1.revertTransaction);
// Database Maintenance Management (Super Admin only)
router.get('/maintenance/tables', (0, adminAuth_middleware_1.requireRole)(['superadmin']), maintenance_controller_1.getCleanableTables);
router.post('/maintenance/preview', (0, adminAuth_middleware_1.requireRole)(['superadmin']), maintenance_controller_1.previewMaintenanceRecords);
router.post('/maintenance/export', (0, adminAuth_middleware_1.requireRole)(['superadmin']), maintenance_controller_1.exportMaintenanceRecords);
router.post('/maintenance/cleanup', (0, adminAuth_middleware_1.requireRole)(['superadmin']), maintenance_controller_1.cleanupMaintenanceRecords);
router.post('/maintenance/nuclear-reset', (0, adminAuth_middleware_1.requireRole)(['superadmin']), maintenance_controller_1.systemNuclearReset);
exports.default = router;
