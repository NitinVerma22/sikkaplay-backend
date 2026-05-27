import { Router } from 'express';
import { getAppConfig } from '../controllers/config.controller';

const router = Router();

// Route to get app configuration like latest version, maintenance mode etc.
router.get('/', getAppConfig);

export default router;
