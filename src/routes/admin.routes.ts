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
  getWithdrawals,
  updateWithdrawalStatus,
  bulkUpdateWithdrawalStatus,
  getSupportTickets,
  replySupportTicket,
  toggleUserFreeze,
  broadcastPushNotification
} from '../controllers/admin.controller';
import { requireAdminJwt } from '../middleware/adminAuth.middleware';
import { createDailyCode, getDailyCodes } from '../controllers/dailyCode.controller';
import { createVisitLink, getVisitLinks, deleteVisitLink } from '../controllers/visitLink.controller';

const router = Router();

// Public route for Admin login
router.post('/login', loginAdmin);

// Protect all other routes with admin JWT validation
router.use(requireAdminJwt);

// Stats & Dashboard Overview
router.get('/stats', getDashboardStats);

// App Config Settings
router.get('/config', getConfigs);
router.put('/config', updateConfigs);

// User Management
router.get('/users', getUsers);
router.put('/users/:id/balance', updateUserBalance);
router.put('/users/:id/freeze', toggleUserFreeze);
router.delete('/users/:id', deleteUser);
router.post('/users/bulk-delete', bulkDeleteUsers);

// Push Notification Broadcast
router.post('/broadcast-push', broadcastPushNotification);

// Withdrawal Management
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id', updateWithdrawalStatus);
router.post('/withdrawals/bulk', bulkUpdateWithdrawalStatus);

// Support & FAQ Tickets Management
router.get('/tickets', getSupportTickets);
router.post('/tickets/:id/reply', replySupportTicket);

// Daily Code Management
router.post('/daily-code', createDailyCode);
router.get('/daily-code', getDailyCodes);

// Visit Links Management
router.post('/visit-links', createVisitLink);
router.get('/visit-links', getVisitLinks);
router.delete('/visit-links/:id', deleteVisitLink);

export default router;
