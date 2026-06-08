import { Router } from 'express';
import { startGame, spinWheel, endGame } from '../controllers/game.controller';
import { requireJwt } from '../middleware/auth.middleware';
import { vpnGuard } from '../middleware/vpn.middleware';

const router = Router();

// Protect all game routes with JWT
router.use(requireJwt);

// POST /api/game/start
router.post('/start', startGame);

// POST /api/game/spin — vpnGuard here only (real coins at stake)
router.post('/spin', vpnGuard, spinWheel);

// POST /api/game/end
router.post('/end', endGame);

export default router;
