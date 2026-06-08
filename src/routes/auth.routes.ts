import { Router } from 'express';
import { registerDirect, loginWithPassword, forgotPassword, googleLogin, completeGoogleSignup } from '../controllers/auth.controller';
import { verifyToken } from '../middleware/auth.middleware';
import { vpnGuard } from '../middleware/vpn.middleware';
import { authLimiter } from '../middleware/rateLimiter.middleware';

const router = Router();

// Apply VPN detection and Rate Limiting globally on all auth routes
router.use(vpnGuard);
router.use(authLimiter);

// Register: App sends Phone + Password + Name + City + Referral (No OTP)
router.post('/register', registerDirect);

// Login: App sends Phone + Password (No OTP)
router.post('/login', loginWithPassword);

// Forgot Password: App sends Firebase JWT + New Password
router.post('/forgot-password', verifyToken, forgotPassword);

// POST /api/auth/google-login
router.post('/google-login', verifyToken, googleLogin);

// POST /api/auth/complete-google-signup
// This does not require requireFirebaseUser middleware since they just submit the form with their uid
router.post('/complete-google-signup', completeGoogleSignup);

export default router;
