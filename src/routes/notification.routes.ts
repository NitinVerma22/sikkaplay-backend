import express from 'express';
import { getNotifications, markAsRead, clearNotifications } from '../controllers/notification.controller';
import { requireJwt } from '../middleware/auth.middleware';

const router = express.Router();

router.use(requireJwt);

router.get('/', getNotifications);
router.put('/read', markAsRead);
router.delete('/clear', clearNotifications);

export default router;
