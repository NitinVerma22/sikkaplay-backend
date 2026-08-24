import { Router } from 'express';
import { getProfile, updateFcmToken, getTransactions, updateUpi, recordAdImpression, updateBio, updateAvatar, deleteAccount, syncPhone, updateProfileDetails } from '../controllers/user.controller';
import { getLeaderboard } from '../controllers/leaderboard.controller';
import {
  claimDailyStreak,
  claimSocialTask,
  claimSurvey,
  claimAppInstall,
  getAppInstallOffers,
  claimMilestone,
  resumeDailyStreak
} from '../controllers/earn.controller';
import { logUsage } from '../controllers/usage.controller';
import { getMyNetwork } from '../controllers/network.controller';
import { getHomeState } from '../controllers/home.controller';
import { requireJwt } from '../middleware/auth.middleware';
import { vpnGuard } from '../middleware/vpn.middleware';
import { earnLimiter, withdrawLimiter } from '../middleware/rateLimiter.middleware';
import { claimDailyCode, getTodayDailyCodeInfo } from '../controllers/dailyCode.controller';
import { getVisitLinks, claimVisitLinkReward } from '../controllers/visitLink.controller';
import { claimSocialTaskUser } from '../controllers/socialTask.controller';

const router = Router();

// Protect all user routes with JWT validation
router.use(requireJwt);
// NOTE: vpnGuard is applied only on earn/withdraw routes below to avoid
// hitting proxycheck.io API on every single profile/home/wallet request.

// GET /api/user/profile
router.get('/profile', getProfile);

// GET /api/user/leaderboard
router.get('/leaderboard', getLeaderboard);

// POST /api/user/fcm-token
router.post('/fcm-token', updateFcmToken);

// GET /api/user/transactions
router.get('/transactions', getTransactions);

// PUT /api/user/upi
router.put('/upi', updateUpi);

// PUT /api/user/bio
router.put('/bio', updateBio);

// PUT /api/user/update-details
router.put('/update-details', updateProfileDetails);

// PUT /api/user/avatar
router.put('/avatar', updateAvatar);

// POST /api/user/sync-phone
router.post('/sync-phone', syncPhone);

// POST /api/user/earn/... — vpnGuard only on earn routes
router.post('/earn/daily-streak', vpnGuard, earnLimiter, claimDailyStreak);
router.post('/earn/daily-streak/resume', vpnGuard, earnLimiter, resumeDailyStreak);
router.post('/earn/social-task', vpnGuard, earnLimiter, claimSocialTask);
router.post('/earn/survey', vpnGuard, earnLimiter, claimSurvey);
router.post('/earn/app-install', vpnGuard, earnLimiter, claimAppInstall);
router.get('/earn/app-install/offers', getAppInstallOffers);
router.post('/earn/milestone', vpnGuard, earnLimiter, claimMilestone);

// POST /api/user/usage
router.post('/usage', logUsage);

// GET /api/user/daily-code/today
router.get('/daily-code/today', getTodayDailyCodeInfo);

// POST /api/user/daily-code/claim
router.post('/daily-code/claim', vpnGuard, earnLimiter, claimDailyCode);

// POST /api/user/social-tasks/:id/claim
router.post('/social-tasks/:id/claim', vpnGuard, earnLimiter, claimSocialTaskUser);

// GET /api/user/network
router.get('/network', getMyNetwork);

// GET /api/user/home
router.get('/home', getHomeState);

// GET /api/user/wallet
import { getWalletStats, requestWithdrawal, getWithdrawalOptions } from '../controllers/wallet.controller';
router.get('/wallet', getWalletStats);
router.get('/wallet/withdrawal-options', getWithdrawalOptions);
router.post('/withdraw', vpnGuard, withdrawLimiter, requestWithdrawal);

// Visit Links
router.get('/visit-links', getVisitLinks);
router.post('/visit-links/claim', vpnGuard, earnLimiter, claimVisitLinkReward);

// Ad Impression Logging
router.post('/ad-impression', recordAdImpression);

// DELETE /api/user/me
router.delete('/me', deleteAccount);

export default router;
