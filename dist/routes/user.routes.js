"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("../controllers/user.controller");
const earn_controller_1 = require("../controllers/earn.controller");
const usage_controller_1 = require("../controllers/usage.controller");
const network_controller_1 = require("../controllers/network.controller");
const home_controller_1 = require("../controllers/home.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Protect all user routes with JWT validation
router.use(auth_middleware_1.requireJwt);
// GET /api/user/profile
router.get('/profile', user_controller_1.getProfile);
// POST /api/user/fcm-token
router.post('/fcm-token', user_controller_1.updateFcmToken);
// GET /api/user/transactions
router.get('/transactions', user_controller_1.getTransactions);
// PUT /api/user/upi
router.put('/upi', user_controller_1.updateUpi);
// POST /api/user/earn
router.post('/earn', earn_controller_1.claimReward);
// POST /api/user/usage
router.post('/usage', usage_controller_1.logUsage);
// GET /api/user/network
router.get('/network', network_controller_1.getMyNetwork);
// GET /api/user/home
router.get('/home', home_controller_1.getHomeState);
// GET /api/user/wallet
const wallet_controller_1 = require("../controllers/wallet.controller");
router.get('/wallet', wallet_controller_1.getWalletStats);
exports.default = router;
