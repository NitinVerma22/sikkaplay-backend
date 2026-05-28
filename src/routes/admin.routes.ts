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

export default router;
