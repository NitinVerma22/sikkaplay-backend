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
  setTypingStatus
} from '../controllers/playground.controller';

const router = Router();

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
router.post('/matchmaking/join', joinMatchmaking);
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
router.post('/chat/send', sendPlaygroundMessage);
router.get('/chat/sync', syncPlaygroundMessages);
router.post('/chat/active', updateActiveChannel);
router.post('/chat/clear', clearChatHistory);
router.post('/chat/typing', setTypingStatus);

// Profile
router.post('/profile/bio', updateBio);
router.get('/profile/search', getPublicProfile);

// Safety
router.post('/report', reportUser);

export default router;
