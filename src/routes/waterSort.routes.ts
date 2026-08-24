import { Router } from 'express';
import { getWaterSortProgress, completeWaterSortLevel } from '../controllers/waterSort.controller';
import { requireJwt } from '../middleware/auth.middleware';

const router = Router();

router.get('/progress', requireJwt, getWaterSortProgress);
router.post('/complete-level', requireJwt, completeWaterSortLevel);

export default router;
