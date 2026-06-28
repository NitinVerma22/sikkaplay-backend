"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const playground_controller_1 = require("../controllers/playground.controller");
const router = (0, express_1.Router)();
// Protect all playground routes with JWT validation
router.use(auth_middleware_1.requireJwt);
// Lobby & Economy
router.get('/lobby', playground_controller_1.getPlaygroundLobby);
router.post('/swap-minutes', playground_controller_1.swapCoinsForMinutes);
// Username Setup
router.post('/username/check', playground_controller_1.checkUsernameUnique);
router.post('/username/set', playground_controller_1.setUsername);
// Crates Playtime
router.post('/crates/claim', playground_controller_1.claimCrate);
// Matchmaking
router.post('/matchmaking/join', playground_controller_1.joinMatchmaking);
router.post('/matchmaking/status', playground_controller_1.checkMatchmakingStatus);
// Friends
router.get('/friends', playground_controller_1.getFriendsList);
router.get('/friends/search', playground_controller_1.searchFriends);
router.post('/friends/request', playground_controller_1.sendFriendRequest);
router.post('/friends/accept', playground_controller_1.acceptFriendRequest);
// Gifts
router.post('/gifts/send', playground_controller_1.sendVirtualGift);
router.post('/gifts/sell', playground_controller_1.sellVirtualGift);
// Safety
router.post('/report', playground_controller_1.reportUser);
exports.default = router;
