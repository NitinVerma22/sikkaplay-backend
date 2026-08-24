import { Router } from 'express';
import { requireJwt } from '../middleware/auth.middleware';
import { getArrowEscapeProgress, completeArrowEscapeLevel } from '../controllers/arrowEscape.controller';

const router = Router();

router.get('/progress', requireJwt, getArrowEscapeProgress);
router.post('/complete-level', requireJwt, completeArrowEscapeLevel);

export default router;
