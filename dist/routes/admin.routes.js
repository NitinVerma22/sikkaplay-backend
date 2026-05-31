"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_controller_1 = require("../controllers/admin.controller");
const adminAuth_middleware_1 = require("../middleware/adminAuth.middleware");
const dailyCode_controller_1 = require("../controllers/dailyCode.controller");
const visitLink_controller_1 = require("../controllers/visitLink.controller");
const router = (0, express_1.Router)();
// Public route for Admin login
router.post('/login', admin_controller_1.loginAdmin);
// Protect all other routes with admin JWT validation
router.use(adminAuth_middleware_1.requireAdminJwt);
// Stats & Dashboard Overview
router.get('/stats', admin_controller_1.getDashboardStats);
// App Config Settings
router.get('/config', admin_controller_1.getConfigs);
router.put('/config', admin_controller_1.updateConfigs);
// User Management
router.get('/users', admin_controller_1.getUsers);
router.put('/users/:id/balance', admin_controller_1.updateUserBalance);
router.delete('/users/:id', admin_controller_1.deleteUser);
// Withdrawal Management
router.get('/withdrawals', admin_controller_1.getWithdrawals);
router.put('/withdrawals/:id', admin_controller_1.updateWithdrawalStatus);
// Support & FAQ Tickets Management
router.get('/tickets', admin_controller_1.getSupportTickets);
router.post('/tickets/:id/reply', admin_controller_1.replySupportTicket);
// Daily Code Management
router.post('/daily-code', dailyCode_controller_1.createDailyCode);
router.get('/daily-code', dailyCode_controller_1.getDailyCodes);
// Visit Links Management
router.post('/visit-links', visitLink_controller_1.createVisitLink);
router.get('/visit-links', visitLink_controller_1.getVisitLinks);
router.delete('/visit-links/:id', visitLink_controller_1.deleteVisitLink);
exports.default = router;
