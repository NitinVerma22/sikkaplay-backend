import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { getArrowEscapeProgress, completeArrowEscapeLevel } from '../controllers/arrowEscape.controller';

const router = Router();

router.get('/progress', verifyToken, getArrowEscapeProgress);
router.post('/complete-level', verifyToken, completeArrowEscapeLevel);

export default router;
