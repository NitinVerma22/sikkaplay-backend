import { Router } from 'express';
import { requireJwt } from '../middleware/auth.middleware';
import { vpnGuard } from '../middleware/vpn.middleware';
import {
  getPlaygroundLobby,
  swapCoinsForMinutes,
  checkUsernameUnique,
  setUsername,
  claimCrate,
  joinMatchmaking,
  checkMatchmakingStatus,
  getFriendsList,
  searchFriends,
  sendFriendRequest,
  acceptFriendRequest,
  unfriendUser,
  sendVirtualGift,
  sellVirtualGift,
  reportUser,
  sendPlaygroundMessage,
  syncPlaygroundMessages,
  updateBio,
  getPublicProfile,
  updateActiveChannel,
  clearChatHistory,
  setTypingStatus,
  blockUser,
  unblockUser,
  getBlockedUsers
} from '../controllers/playground.controller';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiters to prevent API abuse and DDoS
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // Max 30 messages per minute per IP
  message: { error: 'Too many messages sent. Please slow down.' }
});

const matchmakingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Max 10 matchmaking requests per minute
  message: { error: 'Too many matchmaking attempts. Please slow down.' }
});

// Protect all playground routes with JWT validation
router.use(requireJwt);

// Lobby & Economy
router.get('/lobby', getPlaygroundLobby);
router.post('/swap-minutes', swapCoinsForMinutes);

// Username Setup
router.post('/username/check', checkUsernameUnique);
router.post('/username/set', setUsername);

// Crates Playtime
router.post('/crates/claim', claimCrate);

// Matchmaking
router.post('/matchmaking/join', matchmakingLimiter, joinMatchmaking);
router.post('/matchmaking/status', checkMatchmakingStatus);

// Friends
router.get('/friends', getFriendsList);
router.get('/friends/search', searchFriends);
router.post('/friends/request', sendFriendRequest);
router.post('/friends/accept', acceptFriendRequest);
router.post('/friends/unfriend', unfriendUser);

// Gifts
router.post('/gifts/send', sendVirtualGift);
router.post('/gifts/sell', sellVirtualGift);

// Chat messaging Polling Relay
router.post('/chat/send', chatLimiter, sendPlaygroundMessage);
router.get('/chat/sync', syncPlaygroundMessages);
router.post('/chat/active', updateActiveChannel);
router.post('/chat/clear', clearChatHistory);
router.post('/chat/typing', setTypingStatus);

// Profile
router.post('/profile/bio', updateBio);
router.get('/profile/search', getPublicProfile);

// Safety & Privacy
router.post('/report', reportUser);
router.post('/block', blockUser);
router.post('/unblock', unblockUser);
router.get('/blocked', getBlockedUsers);

export default router;
