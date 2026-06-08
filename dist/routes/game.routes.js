"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const game_controller_1 = require("../controllers/game.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const vpn_middleware_1 = require("../middleware/vpn.middleware");
const router = (0, express_1.Router)();
// Protect all game routes with JWT and VPN checks
router.use(auth_middleware_1.requireJwt);
router.use(vpn_middleware_1.vpnGuard);
// POST /api/game/start
router.post('/start', game_controller_1.startGame);
// POST /api/game/spin
router.post('/spin', game_controller_1.spinWheel);
// POST /api/game/end
router.post('/end', game_controller_1.endGame);
exports.default = router;
