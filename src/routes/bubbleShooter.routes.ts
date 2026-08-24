import { Router } from 'express';
import { requireJwt } from '../middleware/auth.middleware';
import { getBubbleShooterProgress, completeBubbleShooterLevel } from '../controllers/bubbleShooter.controller';

const router = Router();

router.get('/progress', requireJwt, getBubbleShooterProgress);
router.post('/complete-level', requireJwt, completeBubbleShooterLevel);

export default router;
