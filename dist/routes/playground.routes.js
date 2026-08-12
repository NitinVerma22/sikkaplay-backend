"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const playground_controller_1 = require("../controllers/playground.controller");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
// Rate limiters to prevent API abuse and DDoS
const chatLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute window
    max: 30, // Max 30 messages per minute per IP
    message: { error: 'Too many messages sent. Please slow down.' }
});
const matchmakingLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute window
    max: 10, // Max 10 matchmaking requests per minute
    message: { error: 'Too many matchmaking attempts. Please slow down.' }
});
// Username Setup (Check username uniqueness must be accessible without logging in during registration)
router.post('/username/check', playground_controller_1.checkUsernameUnique);
// Protect all playground routes with JWT validation
router.use(auth_middleware_1.requireJwt);
// Lobby & Economy
router.get('/lobby', playground_controller_1.getPlaygroundLobby);
router.post('/swap-minutes', playground_controller_1.swapCoinsForMinutes);
// Username Setup (Setting username requires auth)
router.post('/username/set', playground_controller_1.setUsername);
// Crates Playtime
router.post('/crates/claim', playground_controller_1.claimCrate);
// Matchmaking
router.post('/matchmaking/join', matchmakingLimiter, playground_controller_1.joinMatchmaking);
router.post('/matchmaking/status', playground_controller_1.checkMatchmakingStatus);
// Friends
router.get('/friends', playground_controller_1.getFriendsList);
router.get('/friends/suggestions', playground_controller_1.getSuggestions);
router.get('/friends/search', playground_controller_1.searchFriends);
router.post('/friends/request', playground_controller_1.sendFriendRequest);
router.post('/friends/accept', playground_controller_1.acceptFriendRequest);
router.post('/friends/unfriend', playground_controller_1.unfriendUser);
// Gifts
router.post('/gifts/send', playground_controller_1.sendVirtualGift);
router.post('/gifts/sell', playground_controller_1.sellVirtualGift);
// Chat messaging Polling Relay
router.post('/chat/send', chatLimiter, playground_controller_1.sendPlaygroundMessage);
router.get('/chat/sync', playground_controller_1.syncPlaygroundMessages);
router.post('/chat/active', playground_controller_1.updateActiveChannel);
router.post('/chat/clear', playground_controller_1.clearChatHistory);
router.post('/chat/typing', playground_controller_1.setTypingStatus);
// Profile
router.post('/profile/bio', playground_controller_1.updateBio);
router.get('/profile/search', playground_controller_1.getPublicProfile);
// Safety & Privacy
router.post('/report', playground_controller_1.reportUser);
router.post('/block', playground_controller_1.blockUser);
router.post('/unblock', playground_controller_1.unblockUser);
router.get('/blocked', playground_controller_1.getBlockedUsers);
exports.default = router;
