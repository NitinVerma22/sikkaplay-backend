import { Router } from 'express';
import { handleCpxCallback } from '../controllers/callback.controller';

const router = Router();

// Public webhook route called by CPX Research
// Supports both GET and POST requests
router.get('/cpx', handleCpxCallback);
router.post('/cpx', handleCpxCallback);

export default router;
