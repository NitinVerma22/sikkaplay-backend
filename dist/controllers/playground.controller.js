"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTypingStatus = exports.clearChatHistory = exports.unfriendUser = exports.getBlockedUsers = exports.unblockUser = exports.blockUser = exports.getPublicProfile = exports.updateBio = exports.updateActiveChannel = exports.syncPlaygroundMessages = exports.sendPlaygroundMessage = exports.reportUser = exports.sellVirtualGift = exports.sendVirtualGift = exports.acceptFriendRequest = exports.sendFriendRequest = exports.searchFriends = exports.getFriendsList = exports.checkMatchmakingStatus = exports.joinMatchmaking = exports.claimCrate = exports.setUsername = exports.checkUsernameUnique = exports.swapCoinsForMinutes = exports.getPlaygroundLobby = exports.typingUsersCache = exports.userActiveChannelCache = void 0;
const db_1 = require("../config/db");
const date_utils_1 = require("../utils/date.utils");
const crypto_utils_1 = require("../utils/crypto.utils");
const node_cache_1 = __importDefault(require("node-cache"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const push_service_1 = require("../services/push.service");
const index_1 = require("../index");
// Helper function to calculate user streak (Mocked as requested)
async function calculateUserStreak(userId, prismaClient) {
    return 1; // Mocked streak
}
exports.userActiveChannelCache = new node_cache_1.default({ stdTTL: 15 });
exports.typingUsersCache = new node_cache_1.default({ stdTTL: 6 });
const ensureSeedData = async () => {
    try {
        const giftCount = await db_1.prisma.gift.count();
        if (giftCount === 0) {
            console.log('Seeding Playground Gift items...');
            await db_1.prisma.gift.createMany({
                data: [
                    { name: 'Coffee', coinsPrice: 50, imageUrl: 'https://cdn-icons-png.flaticon.com/128/924/924514.png' },
                    { name: 'Heart', coinsPrice: 50, imageUrl: 'https://cdn-icons-png.flaticon.com/128/833/833472.png' },
                    { name: 'Ice Cream', coinsPrice: 100, imageUrl: 'https://cdn-icons-png.flaticon.com/128/933/933155.png' },
                    { name: 'Bouquet', coinsPrice: 100, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2088/2088926.png' },
                    { name: 'Rose', coinsPrice: 200, imageUrl: 'https://cdn-icons-png.flaticon.com/128/726/726131.png' },
                    { name: 'Watch', coinsPrice: 200, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2921/2921946.png' },
                    { name: 'Chocolate', coinsPrice: 500, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2422/2422204.png' },
                    { name: 'Female Shoes', coinsPrice: 500, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2237/2237061.png' },
                    { name: 'Boys Shoes', coinsPrice: 500, imageUrl: 'https://cdn-icons-png.flaticon.com/128/3321/3321319.png' },
                    { name: 'Crown', coinsPrice: 1000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/694/694984.png' },
                    { name: 'Female Bag', coinsPrice: 1000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/3183/3183022.png' },
                    { name: 'Ring', coinsPrice: 2000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2650/2650228.png' },
                    { name: 'Dress', coinsPrice: 2000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/3342/3342132.png' },
                    { name: 'Coat Pant', coinsPrice: 2000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/3050/3050410.png' },
                    { name: 'Jewelry', coinsPrice: 2000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2381/2381007.png' },
                    { name: 'Female Jackpot', coinsPrice: 5000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/4129/4129432.png' },
                    { name: 'Boys Kit', coinsPrice: 5000, imageUrl: 'https://cdn-icons-png.flaticon.com/128/2821/2821817.png' },
                ]
            });
        }
    }
    catch (err) {
        console.error('Error seeding playground items:', err);
    }
};
// Legacy in-memory matchmaking removed in favor of WebSocket + Redis architecture
// 1. Lobby Status Dashboard
const getPlaygroundLobby = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        await ensureSeedData();
        // Fetch user details including gift showcase
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                giftInventory: {
                    include: { gift: true }
                }
            }
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (!user.username) {
            const baseName = (user.name || 'player').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 10);
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            const generated = `${baseName || 'user'}_${randomSuffix}`;
            try {
                const updated = await db_1.prisma.user.update({
                    where: { id: userId },
                    data: { username: generated }
                });
                user.username = updated.username;
            }
            catch (e) {
                user.username = `user_${userId.substring(0, 8)}`;
                await db_1.prisma.user.update({
                    where: { id: userId },
                    data: { username: user.username }
                }).catch(() => { });
            }
        }
        // Get today's playtime crate progress
        const todayStr = (0, date_utils_1.getISTDateString)();
        let crateProgress = await db_1.prisma.crateProgress.findUnique({
            where: {
                userId_dateStr: {
                    userId,
                    dateStr: todayStr
                }
            }
        });
        let dailyUsage = await db_1.prisma.dailyUsage.findUnique({
            where: { userId_dateStr: { userId, dateStr: todayStr } }
        });
        const gamesSeconds = (dailyUsage?.gamesMinutes || 0) * 60;
        if (!crateProgress) {
            crateProgress = await db_1.prisma.crateProgress.create({
                data: {
                    userId,
                    dateStr: todayStr,
                    activeSeconds: gamesSeconds
                }
            });
        }
        else {
            crateProgress = await db_1.prisma.crateProgress.update({
                where: { id: crateProgress.id },
                data: {
                    activeSeconds: gamesSeconds
                }
            });
        }
        // Fetch friends count
        const friendsCount = await db_1.prisma.friendship.count({
            where: {
                OR: [
                    { userOneId: userId },
                    { userTwoId: userId }
                ],
                status: 'ACCEPTED'
            }
        });
        // Calculate Global Rank
        const rankCount = await db_1.prisma.user.count({
            where: { totalEarned: { gt: user.totalEarned } }
        });
        const globalRank = rankCount + 1;
        const userStreak = await calculateUserStreak(userId, db_1.prisma);
        res.status(200).json({
            success: true,
            balance: user.balance + user.referralBalance,
            totalEarned: user.totalEarned,
            playgroundMinutes: user.playgroundMinutes,
            gender: user.gender,
            name: user.name || 'SikkaPlay Player',
            username: user.username,
            avatarUrl: user.avatarUrl,
            giftInventory: user.giftInventory,
            crateProgress,
            friendsCount,
            streak: userStreak,
            globalRank: globalRank,
            dailyLogin: 7, // Mocked for now
        });
    }
    catch (error) {
        console.error('Error fetching playground lobby:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getPlaygroundLobby = getPlaygroundLobby;
// 2. Swap Sikka Coins for Calling Minutes
const swapCoinsForMinutes = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { minutes } = req.body; // e.g., 5
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const requestedMins = typeof minutes === 'number' ? Math.floor(minutes) : 0;
        if (requestedMins <= 0) {
            res.status(400).json({ error: 'Minutes must be greater than 0' });
            return;
        }
        // Get configuration
        const config = await db_1.prisma.appConfig.findFirst();
        const coinsPerMin = config?.playgroundCoinsPerMinute ?? 240; // 1200 coins = 5 mins -> 240/min
        const coinsRequired = requestedMins * coinsPerMin;
        const result = await db_1.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { balance: true }
            });
            if (!user)
                throw new Error('User not found');
            if (user.balance < coinsRequired) {
                throw new Error(`Insufficient Sikka Coins. You need ${coinsRequired} coins for ${requestedMins} minutes.`);
            }
            // Deduct coins and add minutes
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { decrement: coinsRequired },
                    playgroundMinutes: { increment: requestedMins }
                }
            });
            // Log transaction
            await tx.transaction.create({
                data: {
                    userId,
                    amount: -coinsRequired,
                    type: 'playground',
                    status: 'success',
                    description: `Exchanged ${coinsRequired} Sikka for ${requestedMins} Call Minutes`
                }
            });
            return {
                balance: updatedUser.balance + updatedUser.referralBalance,
                playgroundMinutes: updatedUser.playgroundMinutes
            };
        });
        res.status(200).json({
            success: true,
            balance: result.balance,
            playgroundMinutes: result.playgroundMinutes,
            message: `Successfully swapped ${coinsRequired} coins for ${requestedMins} calling minutes.`
        });
    }
    catch (error) {
        console.error('Error swapping coins for minutes:', error);
        res.status(400).json({ error: error.message || 'Internal server error' });
    }
};
exports.swapCoinsForMinutes = swapCoinsForMinutes;
// 3. Check Username Uniqueness
const checkUsernameUnique = async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || typeof username !== 'string') {
            res.status(400).json({ error: 'Username is required' });
            return;
        }
        let cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.startsWith('@')) {
            cleanUsername = cleanUsername.substring(1);
        }
        // Alphanumeric regex check (3-15 chars, allowed underscores)
        const regex = /^[a-zA-Z0-9_]{3,15}$/;
        if (!regex.test(cleanUsername)) {
            res.status(200).json({
                success: false,
                available: false,
                error: 'Username must be 3-15 alphanumeric characters and can contain underscores.'
            });
            return;
        }
        const existing = await db_1.prisma.user.findUnique({
            where: { username: cleanUsername }
        });
        res.status(200).json({
            success: true,
            available: !existing
        });
    }
    catch (error) {
        console.error('Error checking username:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.checkUsernameUnique = checkUsernameUnique;
// 4. Set unique username
const setUsername = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { username } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!username || typeof username !== 'string') {
            res.status(400).json({ error: 'Username is required' });
            return;
        }
        let cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.startsWith('@')) {
            cleanUsername = cleanUsername.substring(1);
        }
        const regex = /^[a-zA-Z0-9_]{3,15}$/;
        if (!regex.test(cleanUsername)) {
            res.status(400).json({ error: 'Invalid username format.' });
            return;
        }
        // Check availability
        const existing = await db_1.prisma.user.findUnique({
            where: { username: cleanUsername }
        });
        if (existing && existing.id !== userId) {
            res.status(400).json({ error: 'Username is already taken by another player.' });
            return;
        }
        const updated = await db_1.prisma.user.update({
            where: { id: userId },
            data: { username: cleanUsername }
        });
        res.status(200).json({
            success: true,
            username: updated.username,
            message: 'Username saved successfully!'
        });
    }
    catch (error) {
        console.error('Error setting username:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.setUsername = setUsername;
// 6. Claim playtime crate
const claimCrate = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { crateLevel } = req.body; // 'BRONZE' | 'SILVER' | 'GOLD'
        if (!userId || !crateLevel) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        const todayStr = (0, date_utils_1.getISTDateString)();
        const progress = await db_1.prisma.crateProgress.findUnique({
            where: { userId_dateStr: { userId, dateStr: todayStr } }
        });
        if (!progress) {
            res.status(400).json({ error: 'Playtime progress not found for today.' });
            return;
        }
        // Validate milestones: Bronze=1 hour(3600s), Silver=2 hours(7200s), Gold=3 hours(10800s)
        let requiredSeconds = 3600;
        let isAlreadyClaimed = false;
        if (crateLevel === 'BRONZE') {
            requiredSeconds = 3600;
            isAlreadyClaimed = progress.bronzeClaimed;
        }
        else if (crateLevel === 'SILVER') {
            requiredSeconds = 7200;
            isAlreadyClaimed = progress.silverClaimed;
        }
        else if (crateLevel === 'GOLD') {
            requiredSeconds = 10800;
            isAlreadyClaimed = progress.goldClaimed;
        }
        else {
            res.status(400).json({ error: 'Invalid crate level' });
            return;
        }
        if (progress.activeSeconds < requiredSeconds) {
            res.status(400).json({
                error: `Insufficient playtime. You need ${Math.ceil((requiredSeconds - progress.activeSeconds) / 60)} more minutes to unlock.`
            });
            return;
        }
        if (isAlreadyClaimed) {
            res.status(400).json({ error: 'This crate has already been claimed today.' });
            return;
        }
        const updateObj = {};
        if (crateLevel === 'BRONZE')
            updateObj.bronzeClaimed = true;
        else if (crateLevel === 'SILVER')
            updateObj.silverClaimed = true;
        else if (crateLevel === 'GOLD')
            updateObj.goldClaimed = true;
        const coinAward = crateLevel === 'BRONZE' ? 300 : crateLevel === 'SILVER' ? 600 : 1200;
        const result = await db_1.prisma.$transaction(async (tx) => {
            // Mark claimed
            await tx.crateProgress.update({
                where: { id: progress.id },
                data: updateObj
            });
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: coinAward },
                    totalEarned: { increment: coinAward }
                }
            });
            await tx.transaction.create({
                data: {
                    userId,
                    amount: coinAward,
                    type: 'playground',
                    status: 'success',
                    description: `Claimed ${crateLevel} crate rewards: ${coinAward} Sikka`
                }
            });
            return {
                balance: updatedUser.balance + updatedUser.referralBalance
            };
        });
        res.status(200).json({
            success: true,
            rewardType: 'coins',
            rewardAmount: coinAward,
            balance: result.balance
        });
    }
    catch (error) {
        console.error('Error claiming crate:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.claimCrate = claimCrate;
// 7. Matchmaking Join API (Legacy / Fallback)
const joinMatchmaking = async (req, res) => {
    res.status(200).json({
        success: true,
        status: 'searching',
        message: 'Matchmaking is handled via real-time WebSocket events.'
    });
};
exports.joinMatchmaking = joinMatchmaking;
// 8. Matchmaking Status Check (Legacy / Fallback)
const checkMatchmakingStatus = async (req, res) => {
    res.status(200).json({
        success: true,
        status: 'idle',
        message: 'Matchmaking is handled via real-time WebSocket events.'
    });
};
exports.checkMatchmakingStatus = checkMatchmakingStatus;
// 9. Fetch Friends list
const getFriendsList = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const friendships = await db_1.prisma.friendship.findMany({
            where: {
                OR: [
                    { userOneId: userId },
                    { userTwoId: userId }
                ]
            }
        });
        // Populate profiles of friends
        const friends = [];
        const pendingRequests = [];
        for (const f of friendships) {
            const friendId = f.userOneId === userId ? f.userTwoId : f.userOneId;
            const friendUser = await db_1.prisma.user.findUnique({
                where: { id: friendId }
            });
            if (friendUser) {
                const ids = [userId, friendUser.id].sort();
                const channelName = `private-chat-${ids[0]}-${ids[1]}`;
                const hiddenChat = await db_1.prisma.hiddenChat.findUnique({
                    where: { userId_channelName: { userId, channelName } }
                });
                const lastMessage = await db_1.prisma.playgroundMessage.findFirst({
                    where: {
                        channelName,
                        ...(hiddenChat ? { createdAt: { gt: hiddenChat.hiddenAt } } : {})
                    },
                    orderBy: { createdAt: 'desc' }
                });
                const unreadCount = await db_1.prisma.playgroundMessage.count({
                    where: {
                        channelName,
                        senderId: friendUser.id,
                        isSeen: false,
                        ...(hiddenChat ? { createdAt: { gt: hiddenChat.hiddenAt } } : {})
                    }
                });
                const item = {
                    friendshipId: f.id,
                    id: friendUser.id,
                    name: friendUser.name || 'Friend',
                    gender: friendUser.gender,
                    username: friendUser.username,
                    avatarUrl: friendUser.avatarUrl,
                    createdAt: f.createdAt,
                    isOnline: auth_middleware_1.onlineUsersCache.has(friendUser.id),
                    lastMessageText: lastMessage ? lastMessage.text : null,
                    lastMessageTime: lastMessage ? lastMessage.createdAt : null,
                    unreadCount
                };
                if (f.status === 'ACCEPTED') {
                    friends.push(item);
                }
                else if (f.status === 'PENDING') {
                    // If actionUserId is NOT the logged-in user, it is incoming pending request
                    if (f.actionUserId !== userId) {
                        pendingRequests.push(item);
                    }
                }
            }
        }
        res.status(200).json({
            success: true,
            friends,
            pendingRequests
        });
    }
    catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getFriendsList = getFriendsList;
// 10. Friends lookup search
const searchFriends = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { query } = req.query; // Display name or phone/uuid lookup
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!query || typeof query !== 'string') {
            res.status(400).json({ error: 'Search query is required' });
            return;
        }
        const isPhoneNumber = /^[0-9+]+$/.test(query.trim());
        // Find users (excluding self) matching display name or matching phone number
        const matches = await db_1.prisma.user.findMany({
            where: {
                id: { not: userId },
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { username: { contains: query, mode: 'insensitive' } },
                    isPhoneNumber ? { phoneNumber: (0, crypto_utils_1.encrypt)(query.trim()) } : undefined
                ].filter(Boolean)
            },
            take: 20
        });
        res.status(200).json({
            success: true,
            users: matches.map(u => ({
                id: u.id,
                name: u.name || 'SikkaPlay Player',
                gender: u.gender,
                username: u.username,
                avatarUrl: u.avatarUrl
            }))
        });
    }
    catch (error) {
        console.error('Error searching friends:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.searchFriends = searchFriends;
// 11. Send Friend Request
const sendFriendRequest = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { targetUserId } = req.body;
        if (!userId || !targetUserId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        if (userId === targetUserId) {
            res.status(400).json({ error: 'Cannot add yourself as a friend' });
            return;
        }
        // Sort IDs to maintain unique pair index
        const [u1, u2] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
        // Check existing
        const existing = await db_1.prisma.friendship.findUnique({
            where: {
                userOneId_userTwoId: {
                    userOneId: u1,
                    userTwoId: u2
                }
            }
        });
        if (existing) {
            res.status(400).json({ error: `Friendship already exists with status: ${existing.status}` });
            return;
        }
        const friendship = await db_1.prisma.friendship.create({
            data: {
                userOneId: u1,
                userTwoId: u2,
                status: 'PENDING',
                actionUserId: userId
            }
        });
        // Send push notification to target user
        const sender = await db_1.prisma.user.findUnique({ where: { id: userId } });
        const senderName = sender?.name || sender?.username || 'SikkaPlay User';
        const recipientUser = await db_1.prisma.user.findUnique({ where: { id: targetUserId } });
        if (recipientUser?.fcmToken) {
            await (0, push_service_1.sendPushNotification)(recipientUser.fcmToken, 'New Friend Request', `${senderName} sent you a friend request!`, 'friend_request', null, userId);
        }
        res.status(200).json({
            success: true,
            friendship,
            message: 'Friend request sent successfully.'
        });
    }
    catch (error) {
        console.error('Error sending friend request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.sendFriendRequest = sendFriendRequest;
// 12. Accept Friend Request
const acceptFriendRequest = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { friendshipId } = req.body;
        if (!userId || !friendshipId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        const f = await db_1.prisma.friendship.findUnique({
            where: { id: friendshipId }
        });
        if (!f) {
            res.status(404).json({ error: 'Friend request not found' });
            return;
        }
        // Confirm that the logged-in user is the receiver, not the sender
        if (f.actionUserId === userId) {
            res.status(400).json({ error: 'You cannot accept your own request. Waiting for partner approval.' });
            return;
        }
        const updated = await db_1.prisma.friendship.update({
            where: { id: friendshipId },
            data: {
                status: 'ACCEPTED'
            }
        });
        // Send push notification to target user (the one who sent the request)
        const targetUserId = updated.userOneId === userId ? updated.userTwoId : updated.userOneId;
        const acceptor = await db_1.prisma.user.findUnique({ where: { id: userId } });
        const acceptorName = acceptor?.name || acceptor?.username || 'SikkaPlay User';
        const targetUser = await db_1.prisma.user.findUnique({ where: { id: targetUserId } });
        if (targetUser?.fcmToken) {
            await (0, push_service_1.sendPushNotification)(targetUser.fcmToken, 'Friend Request Accepted', `${acceptorName} accepted your friend request!`, 'friend_accept', null, userId);
        }
        res.status(200).json({
            success: true,
            friendship: updated,
            message: 'Friend request accepted.'
        });
    }
    catch (error) {
        console.error('Error accepting friend request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.acceptFriendRequest = acceptFriendRequest;
// 13. Send Virtual Gift
const sendVirtualGift = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { receiverId, giftName } = req.body;
        if (!userId || !receiverId || !giftName) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        const gift = await db_1.prisma.gift.findFirst({
            where: { name: giftName }
        });
        if (!gift) {
            res.status(404).json({ error: 'Gift type not found' });
            return;
        }
        const result = await db_1.prisma.$transaction(async (tx) => {
            const sender = await tx.user.findUnique({
                where: { id: userId },
                select: { balance: true }
            });
            if (!sender)
                throw new Error('Sender user not found');
            if (sender.balance < gift.coinsPrice) {
                throw new Error(`Insufficient Sikka Coins. Gift costs ${gift.coinsPrice} coins.`);
            }
            // Deduct coins from sender
            await tx.user.update({
                where: { id: userId },
                data: { balance: { decrement: gift.coinsPrice } }
            });
            // Add gift to receiver's inventory
            await tx.userGiftInventory.upsert({
                where: {
                    userId_giftId: {
                        userId: receiverId,
                        giftId: gift.id
                    }
                },
                update: {
                    count: { increment: 1 }
                },
                create: {
                    userId: receiverId,
                    giftId: gift.id,
                    count: 1
                }
            });
            // Log transaction
            await tx.transaction.create({
                data: {
                    userId,
                    amount: -gift.coinsPrice,
                    type: 'playground',
                    status: 'success',
                    description: `Sent virtual gift: ${giftName}`
                }
            });
            await tx.giftTransaction.create({
                data: {
                    senderId: userId,
                    receiverId,
                    giftId: gift.id,
                    coinsSpent: gift.coinsPrice
                }
            });
            return { coinsPrice: gift.coinsPrice };
        });
        res.status(200).json({
            success: true,
            message: `Sent ${giftName} successfully!`,
            coinsSpent: result.coinsPrice
        });
    }
    catch (error) {
        console.error('Error sending virtual gift:', error);
        res.status(400).json({ error: error.message || 'Internal server error' });
    }
};
exports.sendVirtualGift = sendVirtualGift;
// 14. Sell Virtual Gift (Redeem for coins)
const sellVirtualGift = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { giftId } = req.body;
        if (!userId || !giftId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        const owned = await db_1.prisma.userGiftInventory.findUnique({
            where: {
                userId_giftId: {
                    userId,
                    giftId
                }
            },
            include: { gift: true }
        });
        if (!owned || owned.count <= 0) {
            res.status(400).json({ error: 'You do not own this gift in your showcase inventory.' });
            return;
        }
        // Retrieve commission rates from config
        const config = await db_1.prisma.appConfig.findFirst();
        const commRate = config?.giftCommissionRate ?? 0.20; // default 20%
        const payoutCoins = Math.floor(owned.gift.coinsPrice * (1 - commRate));
        const result = await db_1.prisma.$transaction(async (tx) => {
            // Decrement inventory
            if (owned.count === 1) {
                await tx.userGiftInventory.delete({
                    where: { id: owned.id }
                });
            }
            else {
                await tx.userGiftInventory.update({
                    where: { id: owned.id },
                    data: { count: { decrement: 1 } }
                });
            }
            // Credit user Sikka coins
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: payoutCoins },
                    totalEarned: { increment: payoutCoins }
                }
            });
            // Log transaction
            await tx.transaction.create({
                data: {
                    userId,
                    amount: payoutCoins,
                    type: 'playground',
                    status: 'success',
                    description: `Sold 1x ${owned.gift.name} from profile showcase`
                }
            });
            return {
                balance: updatedUser.balance + updatedUser.referralBalance
            };
        });
        res.status(200).json({
            success: true,
            payoutCoins,
            balance: result.balance,
            message: `Sold 1x ${owned.gift.name} for ${payoutCoins} Sikka Coins!`
        });
    }
    catch (error) {
        console.error('Error selling virtual gift:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.sellVirtualGift = sellVirtualGift;
// 15. Submit Report & Auto-Block
const reportUser = async (req, res) => {
    try {
        const userId = req.user?.userId; // reporter
        const { reportedUserId, reason } = req.body;
        if (!userId || !reportedUserId || !reason) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        // Record report
        await db_1.prisma.playgroundReport.create({
            data: {
                reporterId: userId,
                reportedId: reportedUserId,
                reason
            }
        });
        // Check count of reports received today (last 24 hours)
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
        const reportCount = await db_1.prisma.playgroundReport.count({
            where: {
                reportedId: reportedUserId,
                createdAt: { gte: twentyFourHoursAgo }
            }
        });
        let autoBanned = false;
        let banExpiresAt = null;
        if (reportCount >= 3) {
            // Auto-ban sandbox rule: 24 hour suspension
            banExpiresAt = new Date();
            banExpiresAt.setHours(banExpiresAt.getHours() + 24);
            await db_1.prisma.playgroundBan.create({
                data: {
                    userId: reportedUserId,
                    expiresAt: banExpiresAt,
                    reason: `Auto-suspended: Accumulated ${reportCount} reports within rolling 24 hours.`
                }
            });
            autoBanned = true;
            console.log(`[SAFETY WARNING] User ${reportedUserId} auto-banned until ${banExpiresAt} due to ${reportCount} reports.`);
        }
        res.status(200).json({
            success: true,
            message: 'Report submitted successfully. Thank you for keeping the playground safe!',
            autoBanned,
            banExpiresAt
        });
    }
    catch (error) {
        console.error('Error reporting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.reportUser = reportUser;
// 16. Send Playground Message (Temporary Polling Buffer with FCM Push notification fallback)
const sendPlaygroundMessage = async (req, res) => {
    try {
        const senderId = req.user?.userId;
        const { channelName, text, recipientId } = req.body;
        if (!senderId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!channelName || !text) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        if (recipientId) {
            const isBlocked = await db_1.prisma.blockedUser.findFirst({
                where: {
                    OR: [
                        { blockerId: senderId, blockedId: recipientId },
                        { blockerId: recipientId, blockedId: senderId }
                    ]
                }
            });
            if (isBlocked) {
                res.status(403).json({ error: 'Messaging not allowed due to block', blocked: true });
                return;
            }
        }
        let finalChannelName = channelName;
        if (recipientId && typeof recipientId === 'string' && (channelName.startsWith('friend-chat-') || channelName.startsWith('private-chat-') || channelName.startsWith('friend-') || channelName.startsWith('private-'))) {
            const ids = [senderId, recipientId].sort();
            finalChannelName = `private-chat-${ids[0]}-${ids[1]}`;
        }
        if (text.startsWith('__REACT__:')) {
            const parts = text.split(':');
            if (parts.length >= 3) {
                const msgId = parts[1];
                const emoji = parts[2];
                try {
                    await db_1.prisma.playgroundMessage.update({
                        where: { id: msgId },
                        data: { reaction: emoji }
                    });
                }
                catch (err) {
                    console.error('Failed to update reaction in DB:', err);
                }
            }
        }
        const msg = await db_1.prisma.playgroundMessage.create({
            data: {
                channelName: finalChannelName,
                senderId,
                text
            }
        });
        // Emit the message in real-time to the socket room
        index_1.io.to(finalChannelName).emit('typing_status', { senderId, isTyping: false });
        if (finalChannelName !== channelName && recipientId) {
            index_1.io.to(`friend-chat-${recipientId}`).emit('typing_status', { senderId, isTyping: false });
            index_1.io.to(`friend-chat-${senderId}`).emit('typing_status', { senderId, isTyping: false });
        }
        index_1.io.to(finalChannelName).emit('new_message', msg);
        if (finalChannelName !== channelName && recipientId) {
            index_1.io.to(`friend-chat-${recipientId}`).emit('new_message', msg);
            index_1.io.to(`friend-chat-${senderId}`).emit('new_message', msg);
        }
        // Check if recipient is active in the same channel. If not, send push notification
        if (recipientId && typeof recipientId === 'string') {
            const activeChannel = exports.userActiveChannelCache.get(recipientId);
            if (activeChannel !== finalChannelName) {
                // Recipient is not viewing this channel - send push!
                const sender = await db_1.prisma.user.findUnique({ where: { id: senderId }, select: { name: true, username: true } });
                const senderName = sender?.name || sender?.username || 'SikkaPlay User';
                const recipientUser = await db_1.prisma.user.findUnique({ where: { id: recipientId }, select: { fcmToken: true, id: true } });
                if (recipientUser?.fcmToken) {
                    const isSignaling = text.startsWith('__');
                    if (!isSignaling) {
                        await (0, push_service_1.sendPushNotification)(recipientUser.fcmToken, `Message from ${senderName}`, text.startsWith('[Reply to:') ? text.split('\n').slice(1).join('\n') : text, 'playground_chat', null, recipientId, false, senderId);
                    }
                }
            }
        }
        res.status(200).json({ success: true, message: msg });
    }
    catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.sendPlaygroundMessage = sendPlaygroundMessage;
// 17. Sync Playground Messages (Seen verify & 24 Hours Retention approach)
const syncPlaygroundMessages = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { channelName, recipientId, history } = req.query;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!channelName || typeof channelName !== 'string') {
            res.status(400).json({ error: 'channelName parameter is required' });
            return;
        }
        let isBlockedByMe = false;
        let isBlockedByPartner = false;
        if (recipientId && typeof recipientId === 'string') {
            const blocks = await db_1.prisma.blockedUser.findMany({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: recipientId },
                        { blockerId: recipientId, blockedId: userId }
                    ]
                }
            });
            for (const b of blocks) {
                if (b.blockerId === userId)
                    isBlockedByMe = true;
                if (b.blockerId === recipientId)
                    isBlockedByPartner = true;
            }
        }
        let finalChannelName = channelName;
        if (recipientId && typeof recipientId === 'string' && (channelName.startsWith('friend-chat-') || channelName.startsWith('private-chat-') || channelName.startsWith('friend-') || channelName.startsWith('private-'))) {
            const ids = [userId, recipientId].sort();
            finalChannelName = `private-chat-${ids[0]}-${ids[1]}`;
        }
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        // Global cleanup of messages older than 24 hours
        await db_1.prisma.playgroundMessage.deleteMany({
            where: {
                createdAt: { lt: twentyFourHoursAgo }
            }
        });
        let messages = [];
        let outgoing = [];
        const hiddenChat = await db_1.prisma.hiddenChat.findUnique({
            where: { userId_channelName: { userId, channelName: finalChannelName } }
        });
        const hiddenAt = hiddenChat ? hiddenChat.hiddenAt : null;
        if (history === 'true') {
            // Fetch full history from the last 24 hours (with global pagination limit)
            messages = await db_1.prisma.playgroundMessage.findMany({
                where: {
                    channelName: finalChannelName,
                    createdAt: {
                        gte: twentyFourHoursAgo,
                        ...(hiddenAt ? { gt: hiddenAt } : {})
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 50
            });
            messages = messages.reverse(); // Ensure chronological order for UI
            // Mark any unread incoming messages in history as seen
            const unreadIncoming = messages.filter(m => m.senderId !== userId && !m.isSeen);
            if (unreadIncoming.length > 0) {
                await db_1.prisma.playgroundMessage.updateMany({
                    where: { id: { in: unreadIncoming.map(m => m.id) } },
                    data: { isSeen: true }
                });
                // Update in-memory objects to show seen
                for (const m of messages) {
                    if (m.senderId !== userId) {
                        m.isSeen = true;
                    }
                }
            }
            // Populate outgoing status for client history sync
            outgoing = messages.filter(m => m.senderId === userId);
        }
        else {
            // Normal sync: fetch only unread incoming messages
            messages = await db_1.prisma.playgroundMessage.findMany({
                where: {
                    channelName: finalChannelName,
                    senderId: { not: userId },
                    isSeen: false
                },
                orderBy: { createdAt: 'asc' }
            });
            // Mark incoming messages as seen
            if (messages.length > 0) {
                await db_1.prisma.playgroundMessage.updateMany({
                    where: { id: { in: messages.map(m => m.id) } },
                    data: { isSeen: true }
                });
            }
            // Fetch outgoing messages from the last 24 hours to return their seen status
            outgoing = await db_1.prisma.playgroundMessage.findMany({
                where: {
                    channelName: finalChannelName,
                    senderId: userId,
                    createdAt: { gte: twentyFourHoursAgo }
                }
            });
        }
        // Determine if recipient is online and typing
        let partnerOnline = false;
        let partnerIsTyping = false;
        if (recipientId && typeof recipientId === 'string') {
            partnerOnline = auth_middleware_1.onlineUsersCache.has(recipientId);
            const typingKey = `${finalChannelName}:${recipientId}`;
            partnerIsTyping = exports.typingUsersCache.has(typingKey);
        }
        const totalDbCount = await db_1.prisma.playgroundMessage.count({
            where: { channelName: finalChannelName }
        });
        res.status(200).json({
            success: true,
            currentUserId: userId,
            messages,
            outgoingStatus: outgoing.map(o => ({ id: o.id, isSeen: o.isSeen })),
            partnerOnline,
            partnerIsTyping,
            totalDbCount,
            isBlockedByMe,
            isBlockedByPartner
        });
    }
    catch (error) {
        console.error('Error syncing messages:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.syncPlaygroundMessages = syncPlaygroundMessages;
// 17b. Heartbeat active channel tracking
const updateActiveChannel = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { channelName, recipientId } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (channelName) {
            let finalChannelName = channelName;
            if (recipientId && typeof recipientId === 'string' && (channelName.startsWith('friend-chat-') || channelName.startsWith('private-chat-') || channelName.startsWith('friend-') || channelName.startsWith('private-'))) {
                const ids = [userId, recipientId].sort();
                finalChannelName = `private-chat-${ids[0]}-${ids[1]}`;
            }
            exports.userActiveChannelCache.set(userId, finalChannelName);
        }
        else {
            exports.userActiveChannelCache.del(userId);
        }
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error updating active channel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateActiveChannel = updateActiveChannel;
// 18. Update personal Bio description
const updateBio = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { bio } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const cleanBio = bio ? bio.trim() : '';
        if (cleanBio.length > 100) {
            res.status(400).json({ error: 'Bio cannot exceed 100 characters' });
            return;
        }
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { bio: cleanBio || null }
        });
        res.status(200).json({ success: true, message: 'Bio updated successfully' });
    }
    catch (error) {
        console.error('Error updating bio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateBio = updateBio;
// 19. Get Public Profile details by username
const getPublicProfile = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { username } = req.query;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!username || typeof username !== 'string') {
            res.status(400).json({ error: 'Username or ID parameter is required' });
            return;
        }
        const queryStr = username.trim();
        let targetUser;
        let cleanQuery = queryStr.toLowerCase();
        if (cleanQuery.startsWith('@'))
            cleanQuery = cleanQuery.substring(1);
        if (queryStr.length === 36 && queryStr.includes('-')) {
            targetUser = await db_1.prisma.user.findUnique({
                where: { id: queryStr },
                include: { giftInventory: { include: { gift: true } } }
            });
        }
        else {
            targetUser = await db_1.prisma.user.findFirst({
                where: {
                    OR: [
                        { username: cleanQuery },
                        { id: queryStr },
                        { name: { equals: queryStr, mode: 'insensitive' } }
                    ]
                },
                include: { giftInventory: { include: { gift: true } } }
            });
        }
        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Check friendship status between current user and target user
        const friendship = await db_1.prisma.friendship.findFirst({
            where: {
                OR: [
                    { userOneId: userId, userTwoId: targetUser.id },
                    { userOneId: targetUser.id, userTwoId: userId }
                ]
            }
        });
        let friendshipState = 'NONE'; // 'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'FRIENDS'
        let friendshipId = null;
        if (friendship) {
            friendshipId = friendship.id;
            if (friendship.status === 'ACCEPTED') {
                friendshipState = 'FRIENDS';
            }
            else if (friendship.status === 'PENDING') {
                if (friendship.actionUserId === userId) {
                    friendshipState = 'PENDING_SENT';
                }
                else {
                    friendshipState = 'PENDING_RECEIVED';
                }
            }
        }
        // Calculate global rank
        const rankCount = await db_1.prisma.user.count({
            where: { totalEarned: { gt: targetUser.totalEarned } }
        });
        const globalRank = rankCount + 1;
        // Calculate streak dynamically
        const userStreak = await calculateUserStreak(targetUser.id, db_1.prisma);
        // Calculate level based on total earned coins
        const level = Math.floor((targetUser.totalEarned) / 1000) + 1;
        const currentLevelXp = targetUser.totalEarned % 1000;
        const nextLevelXp = 1000;
        // Fetch friend count (ACCEPTED status)
        const friendCount = await db_1.prisma.friendship.count({
            where: {
                status: 'ACCEPTED',
                OR: [
                    { userOneId: targetUser.id },
                    { userTwoId: targetUser.id }
                ]
            }
        });
        // Fetch total gifts received
        const totalGiftsReceived = await db_1.prisma.giftTransaction.count({
            where: { receiverId: targetUser.id }
        });
        // Fetch received gifts and group by giftId
        const receivedGiftsRaw = await db_1.prisma.giftTransaction.groupBy({
            by: ['giftId'],
            where: { receiverId: targetUser.id },
            _count: { giftId: true }
        });
        const giftIds = receivedGiftsRaw.map(r => r.giftId);
        const giftsDetails = await db_1.prisma.gift.findMany({ where: { id: { in: giftIds } } });
        const aggregatedGifts = receivedGiftsRaw.map(r => {
            const gift = giftsDetails.find(g => g.id === r.giftId);
            return { gift, count: r._count.giftId };
        }).filter(g => g.gift);
        res.status(200).json({
            success: true,
            user: {
                id: targetUser.id,
                name: targetUser.name || 'SikkaPlay Player',
                username: targetUser.username,
                gender: targetUser.gender || 'male',
                avatarUrl: targetUser.avatarUrl,
                level,
                currentLevelXp,
                nextLevelXp,
                totalEarned: targetUser.totalEarned,
                bio: targetUser.bio || 'Hello! I am using SikkaPlay.',
                friendshipState,
                friendshipId,
                friendCount,
                totalGiftsReceived,
                globalRank,
                streak: userStreak,
                gifts: aggregatedGifts
            }
        });
    }
    catch (error) {
        console.error('Error fetching public profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getPublicProfile = getPublicProfile;
// --- Block User APIs ---
const blockUser = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { targetUserId } = req.body;
        if (!userId || !targetUserId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        if (userId === targetUserId) {
            res.status(400).json({ error: 'Cannot block yourself' });
            return;
        }
        // Upsert block record
        await db_1.prisma.blockedUser.upsert({
            where: { blockerId_blockedId: { blockerId: userId, blockedId: targetUserId } },
            update: {},
            create: { blockerId: userId, blockedId: targetUserId }
        });
        // Do NOT delete friendship so that the chat remains in the list.
        // Force close active chat on socket
        index_1.io.to(`friend-chat-${userId}`).emit('user_blocked', { blockerId: userId, blockedId: targetUserId });
        index_1.io.to(`friend-chat-${targetUserId}`).emit('user_blocked', { blockerId: userId, blockedId: targetUserId });
        res.status(200).json({ success: true, message: 'User blocked successfully' });
    }
    catch (error) {
        console.error('Error blocking user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.blockUser = blockUser;
const unblockUser = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { targetUserId } = req.body;
        if (!userId || !targetUserId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        await db_1.prisma.blockedUser.deleteMany({
            where: { blockerId: userId, blockedId: targetUserId }
        });
        res.status(200).json({ success: true, message: 'User unblocked successfully' });
    }
    catch (error) {
        console.error('Error unblocking user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.unblockUser = unblockUser;
const getBlockedUsers = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const blocked = await db_1.prisma.blockedUser.findMany({
            where: { blockerId: userId },
            include: {
                blocked: {
                    select: { id: true, name: true, username: true, avatarUrl: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        const mapped = blocked.map(b => ({
            userId: b.blocked.id,
            name: b.blocked.name,
            username: b.blocked.username,
            avatarUrl: b.blocked.avatarUrl,
            blockedAt: b.createdAt
        }));
        res.status(200).json({ success: true, blockedUsers: mapped });
    }
    catch (error) {
        console.error('Error fetching blocked users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getBlockedUsers = getBlockedUsers;
// 15b. Unfriend (Delete friendship and wipe private chat history)
const unfriendUser = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { targetUserId } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!targetUserId || typeof targetUserId !== 'string') {
            res.status(400).json({ error: 'targetUserId parameter is required' });
            return;
        }
        // Find and delete the friendship record
        const deletedFriendship = await db_1.prisma.friendship.deleteMany({
            where: {
                OR: [
                    { userOneId: userId, userTwoId: targetUserId },
                    { userOneId: targetUserId, userTwoId: userId }
                ]
            }
        });
        if (deletedFriendship.count === 0) {
            res.status(404).json({ error: 'Friendship not found' });
            return;
        }
        res.status(200).json({ success: true, message: 'Unfriended successfully' });
    }
    catch (error) {
        console.error('Error unfriending user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.unfriendUser = unfriendUser;
// 16b. Clear chat history for a private channel without unfriending
const clearChatHistory = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { recipientId } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!recipientId || typeof recipientId !== 'string') {
            res.status(400).json({ error: 'recipientId parameter is required' });
            return;
        }
        // Construct sorted channel name
        const ids = [userId, recipientId].sort();
        const unifiedChannelName = `private-chat-${ids[0]}-${ids[1]}`;
        const existingHidden = await db_1.prisma.hiddenChat.findUnique({
            where: { userId_channelName: { userId, channelName: unifiedChannelName } }
        });
        if (existingHidden) {
            await db_1.prisma.hiddenChat.update({
                where: { id: existingHidden.id },
                data: { hiddenAt: new Date() }
            });
        }
        else {
            await db_1.prisma.hiddenChat.create({
                data: { userId, channelName: unifiedChannelName, hiddenAt: new Date() }
            });
        }
        res.status(200).json({ success: true, message: 'Chat history cleared successfully' });
    }
    catch (error) {
        console.error('Error clearing chat history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.clearChatHistory = clearChatHistory;
// 23. Update typing status
const setTypingStatus = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { channelName, isTyping, recipientId } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!channelName) {
            res.status(400).json({ error: 'channelName is required' });
            return;
        }
        let finalChannelName = channelName;
        let finalRecipientId = recipientId;
        if (!finalRecipientId && channelName.startsWith('friend-chat-')) {
            finalRecipientId = channelName.substring('friend-chat-'.length);
        }
        if (finalRecipientId && typeof finalRecipientId === 'string' && (channelName.startsWith('friend-chat-') || channelName.startsWith('private-chat-') || channelName.startsWith('friend-') || channelName.startsWith('private-'))) {
            const ids = [userId, finalRecipientId].sort();
            finalChannelName = `private-chat-${ids[0]}-${ids[1]}`;
        }
        const cacheKey = `${finalChannelName}:${userId}`;
        if (isTyping === true) {
            exports.typingUsersCache.set(cacheKey, true);
        }
        else {
            exports.typingUsersCache.del(cacheKey);
        }
        index_1.io.to(finalChannelName).emit('typing_status', { senderId: userId, isTyping });
        if (finalChannelName !== channelName && finalRecipientId) {
            index_1.io.to(`friend-chat-${finalRecipientId}`).emit('typing_status', { senderId: userId, isTyping });
            index_1.io.to(`friend-chat-${userId}`).emit('typing_status', { senderId: userId, isTyping });
        }
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error in setTypingStatus:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.setTypingStatus = setTypingStatus;
