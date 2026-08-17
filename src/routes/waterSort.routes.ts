import { Router } from 'express';
import { getWaterSortProgress, completeWaterSortLevel } from '../controllers/waterSort.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/progress', verifyToken, getWaterSortProgress);
router.post('/complete-level', verifyToken, completeWaterSortLevel);

export default router;
