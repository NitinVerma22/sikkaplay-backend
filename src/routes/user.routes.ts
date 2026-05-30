import { Router } from 'express';
import { getProfile, updateFcmToken, getTransactions, updateUpi } from '../controllers/user.controller';
import { claimReward } from '../controllers/earn.controller';
import { logUsage } from '../controllers/usage.controller';
import { getMyNetwork } from '../controllers/network.controller';
import { getHomeState } from '../controllers/home.controller';
import { requireJwt } from '../middleware/auth.middleware';
import { claimDailyCode } from '../controllers/dailyCode.controller';

const router = Router();

// Protect all user routes with JWT validation
router.use(requireJwt);

// GET /api/user/profile
router.get('/profile', getProfile);

// POST /api/user/fcm-token
router.post('/fcm-token', updateFcmToken);

// GET /api/user/transactions
router.get('/transactions', getTransactions);

// PUT /api/user/upi
router.put('/upi', updateUpi);

// POST /api/user/earn
router.post('/earn', claimReward);

// POST /api/user/usage
router.post('/usage', logUsage);

// POST /api/user/daily-code/claim
router.post('/daily-code/claim', claimDailyCode);

// GET /api/user/network
router.get('/network', getMyNetwork);

// GET /api/user/home
router.get('/home', getHomeState);

// GET /api/user/wallet
import { getWalletStats, requestWithdrawal } from '../controllers/wallet.controller';
router.get('/wallet', getWalletStats);
router.post('/withdraw', requestWithdrawal);

export default router;
