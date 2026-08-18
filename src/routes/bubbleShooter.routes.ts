import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { getBubbleShooterProgress, completeBubbleShooterLevel } from '../controllers/bubbleShooter.controller';

const router = Router();

router.get('/progress', verifyToken, getBubbleShooterProgress);
router.post('/complete-level', verifyToken, completeBubbleShooterLevel);

export default router;
