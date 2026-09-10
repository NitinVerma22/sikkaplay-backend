import { Router } from 'express';
import { handleCpxCallback, handleAdmobSsvCallback } from '../controllers/callback.controller';
import { handleTapjoyCallback } from '../controllers/tapjoy.controller';
import { handleTimewallCallback } from '../controllers/timewall.controller';
import { handleCpaleadCallback } from '../controllers/cpalead.controller';

const router = Router();

// Public webhook route called by CPX Research
// Supports both GET and POST requests
router.get('/cpx', handleCpxCallback);
router.post('/cpx', handleCpxCallback);

// Public webhook route called by Google AdMob SSV
router.get('/admob-ssv', handleAdmobSsvCallback);

// Public webhook route called by Tapjoy Offerwall self-managed currency
router.get('/tapjoy', handleTapjoyCallback);

// Public webhook route called by TimeWall Offerwall
router.get('/timewall', handleTimewallCallback);
router.post('/timewall', handleTimewallCallback);

// Public webhook route called by CPAlead Offerwall
router.get('/cpalead', handleCpaleadCallback);

export default router;
