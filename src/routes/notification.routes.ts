import express from 'express';
import { getNotifications, markAsRead, clearNotifications } from '../controllers/notification.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getNotifications);
router.put('/read', markAsRead);
router.delete('/clear', clearNotifications);

export default router;
