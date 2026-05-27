"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Register: App sends Phone + Password + Name + City + Referral (No OTP)
router.post('/register', auth_controller_1.registerDirect);
// Login: App sends Phone + Password (No OTP)
router.post('/login', auth_controller_1.loginWithPassword);
// Forgot Password: App sends Firebase JWT + New Password
router.post('/forgot-password', auth_middleware_1.verifyToken, auth_controller_1.forgotPassword);
// POST /api/auth/google-login
router.post('/google-login', auth_middleware_1.verifyToken, auth_controller_1.googleLogin);
// POST /api/auth/complete-google-signup
// This does not require requireFirebaseUser middleware since they just submit the form with their uid
router.post('/complete-google-signup', auth_controller_1.completeGoogleSignup);
exports.default = router;
