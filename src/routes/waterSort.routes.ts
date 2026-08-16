import { Router } from 'express';
import { WaterSortController } from '../controllers/waterSort.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new WaterSortController();

router.get('/progress', authenticateToken, controller.getProgress.bind(controller));
router.post('/complete-level', authenticateToken, controller.completeLevel.bind(controller));

export default router;
