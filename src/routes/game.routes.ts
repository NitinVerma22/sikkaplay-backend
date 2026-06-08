import { Router } from 'express';
import { startGame, spinWheel, endGame } from '../controllers/game.controller';
import { requireJwt } from '../middleware/auth.middleware';
import { vpnGuard } from '../middleware/vpn.middleware';

const router = Router();

// Protect all game routes with JWT and VPN checks
router.use(requireJwt);
router.use(vpnGuard);

// POST /api/game/start
router.post('/start', startGame);

// POST /api/game/spin
router.post('/spin', spinWheel);

// POST /api/game/end
router.post('/end', endGame);

export default router;
