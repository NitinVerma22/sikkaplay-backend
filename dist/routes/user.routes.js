"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("../controllers/user.controller");
const leaderboard_controller_1 = require("../controllers/leaderboard.controller");
const earn_controller_1 = require("../controllers/earn.controller");
const usage_controller_1 = require("../controllers/usage.controller");
const network_controller_1 = require("../controllers/network.controller");
const home_controller_1 = require("../controllers/home.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const vpn_middleware_1 = require("../middleware/vpn.middleware");
const rateLimiter_middleware_1 = require("../middleware/rateLimiter.middleware");
const dailyCode_controller_1 = require("../controllers/dailyCode.controller");
const visitLink_controller_1 = require("../controllers/visitLink.controller");
const socialTask_controller_1 = require("../controllers/socialTask.controller");
const router = (0, express_1.Router)();
// Protect all user routes with JWT validation
router.use(auth_middleware_1.requireJwt);
// NOTE: vpnGuard is applied only on earn/withdraw routes below to avoid
// hitting proxycheck.io API on every single profile/home/wallet request.
// GET /api/user/profile
router.get('/profile', user_controller_1.getProfile);
// GET /api/user/leaderboard
router.get('/leaderboard', leaderboard_controller_1.getLeaderboard);
// POST /api/user/fcm-token
router.post('/fcm-token', user_controller_1.updateFcmToken);
// GET /api/user/transactions
router.get('/transactions', user_controller_1.getTransactions);
// PUT /api/user/upi
router.put('/upi', user_controller_1.updateUpi);
// PUT /api/user/bio
router.put('/bio', user_controller_1.updateBio);
// PUT /api/user/update-details
router.put('/update-details', user_controller_1.updateProfileDetails);
// PUT /api/user/avatar
router.put('/avatar', user_controller_1.updateAvatar);
// POST /api/user/sync-phone
router.post('/sync-phone', user_controller_1.syncPhone);
// POST /api/user/earn/... — vpnGuard only on earn routes
router.post('/earn/daily-streak', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.claimDailyStreak);
router.post('/earn/daily-streak/resume', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.resumeDailyStreak);
router.post('/earn/social-task', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.claimSocialTask);
router.post('/earn/survey', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.claimSurvey);
router.post('/earn/app-install', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.claimAppInstall);
router.post('/earn/milestone', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, earn_controller_1.claimMilestone);
// POST /api/user/usage
router.post('/usage', usage_controller_1.logUsage);
// GET /api/user/daily-code/today
router.get('/daily-code/today', dailyCode_controller_1.getTodayDailyCodeInfo);
// POST /api/user/daily-code/claim
router.post('/daily-code/claim', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, dailyCode_controller_1.claimDailyCode);
// POST /api/user/social-tasks/:id/claim
router.post('/social-tasks/:id/claim', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, socialTask_controller_1.claimSocialTaskUser);
// GET /api/user/network
router.get('/network', network_controller_1.getMyNetwork);
// GET /api/user/home
router.get('/home', home_controller_1.getHomeState);
// GET /api/user/wallet
const wallet_controller_1 = require("../controllers/wallet.controller");
router.get('/wallet', wallet_controller_1.getWalletStats);
router.post('/withdraw', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.withdrawLimiter, wallet_controller_1.requestWithdrawal);
// Visit Links
router.get('/visit-links', visitLink_controller_1.getVisitLinks);
router.post('/visit-links/claim', vpn_middleware_1.vpnGuard, rateLimiter_middleware_1.earnLimiter, visitLink_controller_1.claimVisitLinkReward);
// Ad Impression Logging
router.post('/ad-impression', user_controller_1.recordAdImpression);
// DELETE /api/user/me
router.delete('/me', user_controller_1.deleteAccount);
exports.default = router;
