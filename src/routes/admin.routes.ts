import { Router } from 'express';
import {
  loginAdmin,
  getDashboardStats,
  getConfigs,
  updateConfigs,
  getUsers,
  updateUserBalance,
  deleteUser,
  getWithdrawals,
  updateWithdrawalStatus,
  getSupportTickets,
  replySupportTicket
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
router.delete('/users/:id', deleteUser);

// Withdrawal Management
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id', updateWithdrawalStatus);

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
