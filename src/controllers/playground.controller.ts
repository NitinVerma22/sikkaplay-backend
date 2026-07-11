import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import { getISTDateString } from '../utils/date.utils';
import { encrypt } from '../utils/crypto.utils';
import NodeCache from 'node-cache';
import { onlineUsersCache } from '../middleware/auth.middleware';
import { sendPushNotification } from '../services/push.service';

export const userActiveChannelCache = new NodeCache({ stdTTL: 15 });
export const typingUsersCache = new NodeCache({ stdTTL: 6 });

const ensureSeedData = async () => {
  try {
    const giftCount = await prisma.gift.count();
    if (giftCount === 0) {
      console.log('Seeding Playground Gift items...');
      await prisma.gift.createMany({
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
  } catch (err) {
    console.error('Error seeding playground items:', err);
  }
};

// Matchmaking Queue Models
interface MatchmakerUser {
  userId: string;
  gender: string;
  filter: 'random' | 'male' | 'female';
  joinedAt: Date;
}

const matchmakingQueue: MatchmakerUser[] = [];

// Match Results Registry: maps userId -> match metadata
const matchResults = new Map<string, {
  channelName: string;
  agoraToken: string;
  partnerId: string;
  partnerName: string;
  partnerUsername: string | null;
  partnerGender: string;
}>();

// 1. Lobby Status Dashboard
export const getPlaygroundLobby = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await ensureSeedData();

    // Fetch user details including gift showcase
    const user = await prisma.user.findUnique({
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

    // Get today's playtime crate progress
    const todayStr = getISTDateString();
    let crateProgress = await prisma.crateProgress.findUnique({
      where: {
        userId_dateStr: {
          userId,
          dateStr: todayStr
        }
      }
    });

    let dailyUsage = await prisma.dailyUsage.findUnique({
      where: { userId_dateStr: { userId, dateStr: todayStr } }
    });
    const gamesSeconds = (dailyUsage?.gamesMinutes || 0) * 60;

    if (!crateProgress) {
      crateProgress = await prisma.crateProgress.create({
        data: {
          userId,
          dateStr: todayStr,
          activeSeconds: gamesSeconds
        }
      });
    } else {
      crateProgress = await prisma.crateProgress.update({
        where: { id: crateProgress.id },
        data: {
          activeSeconds: gamesSeconds
        }
      });
    }

    // Fetch friends count
    const friendsCount = await prisma.friendship.count({
      where: {
        OR: [
          { userOneId: userId },
          { userTwoId: userId }
        ],
        status: 'ACCEPTED'
      }
    });

    // Calculate Global Rank
    const rankCount = await prisma.user.count({
      where: { totalEarned: { gt: user.totalEarned } }
    });
    const globalRank = rankCount + 1;

    res.status(200).json({
      success: true,
      balance: user.balance + user.referralBalance,
      totalEarned: user.totalEarned,
      playgroundMinutes: user.playgroundMinutes,
      gender: user.gender,
      name: user.name || 'SikkaPlay Player',
      username: user.username,
      giftInventory: user.giftInventory,
      crateProgress,
      friendsCount,
      streak: 18, // Mocked for now
      globalRank: globalRank,
      dailyLogin: 7, // Mocked for now
    });
  } catch (error) {
    console.error('Error fetching playground lobby:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 2. Swap Sikka Coins for Calling Minutes
export const swapCoinsForMinutes = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const config = await prisma.appConfig.findFirst();
    const coinsPerMin = config?.playgroundCoinsPerMinute ?? 240; // 1200 coins = 5 mins -> 240/min
    const coinsRequired = requestedMins * coinsPerMin;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      });

      if (!user) throw new Error('User not found');
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
  } catch (error: any) {
    console.error('Error swapping coins for minutes:', error);
    res.status(400).json({ error: error.message || 'Internal server error' });
  }
};

// 3. Check Username Uniqueness
export const checkUsernameUnique = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const existing = await prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    res.status(200).json({
      success: true,
      available: !existing
    });
  } catch (error) {
    console.error('Error checking username:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 4. Set unique username
export const setUsername = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const existing = await prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    if (existing && existing.id !== userId) {
      res.status(400).json({ error: 'Username is already taken by another player.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { username: cleanUsername }
    });

    res.status(200).json({
      success: true,
      username: updated.username,
      message: 'Username saved successfully!'
    });
  } catch (error) {
    console.error('Error setting username:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 6. Claim playtime crate
export const claimCrate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { crateLevel } = req.body; // 'BRONZE' | 'SILVER' | 'GOLD'

    if (!userId || !crateLevel) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    const todayStr = getISTDateString();
    const progress = await prisma.crateProgress.findUnique({
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
    } else if (crateLevel === 'SILVER') {
      requiredSeconds = 7200;
      isAlreadyClaimed = progress.silverClaimed;
    } else if (crateLevel === 'GOLD') {
      requiredSeconds = 10800;
      isAlreadyClaimed = progress.goldClaimed;
    } else {
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

    const updateObj: any = {};
    if (crateLevel === 'BRONZE') updateObj.bronzeClaimed = true;
    else if (crateLevel === 'SILVER') updateObj.silverClaimed = true;
    else if (crateLevel === 'GOLD') updateObj.goldClaimed = true;

    const coinAward = crateLevel === 'BRONZE' ? 300 : crateLevel === 'SILVER' ? 600 : 1200;

    const result = await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    console.error('Error claiming crate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 7. Matchmaking Join API
export const joinMatchmaking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { filter, gender } = req.body; // 'random' | 'male' | 'female'

    if (!userId || !filter) {
      res.status(400).json({ error: 'Filter is required' });
      return;
    }

    // Check if user is blocked or banned
    const ban = await prisma.playgroundBan.findFirst({
      where: {
        userId,
        expiresAt: { gte: new Date() }
      }
    });

    if (ban) {
      res.status(403).json({
        error: `Matchmaking suspended. Your playground privileges are suspended until ${ban.expiresAt.toLocaleString()} due to reports.`
      });
      return;
    }

    // If gender is provided, update it before fetching
    if (gender) {
      await prisma.user.update({
        where: { id: userId },
        data: { gender }
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Validate if already in queue, remove if exists to refresh
    const idx = matchmakingQueue.findIndex(q => q.userId === userId);
    if (idx !== -1) {
      matchmakingQueue.splice(idx, 1);
    }

    // Handle premium gender filters billing
    const config = await prisma.appConfig.findFirst();
    let filterCost = 0;
    if (filter === 'male') filterCost = config?.playgroundMaleFilterCost ?? 50;
    else if (filter === 'female') filterCost = config?.playgroundFemaleFilterCost ?? 50;

    if (filterCost > 0) {
      if (user.balance < filterCost) {
        res.status(400).json({ error: `Insufficient Sikka Coins. Premium filter costs ${filterCost} coins.` });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: filterCost } }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: -filterCost,
            type: 'playground',
            status: 'success',
            description: `Deducted premium matchmaking filter cost (${filter} filter)`
          }
        });
      });
    }

    const userGender = user.gender || 'male';

    // Insert user into queue
    const queuedUser: MatchmakerUser = {
      userId,
      gender: userGender,
      filter,
      joinedAt: new Date()
    };

    // Try to find a match in the active queue
    let matchedPartner: MatchmakerUser | null = null;
    for (let i = 0; i < matchmakingQueue.length; i++) {
      const peer = matchmakingQueue[i];

      // Matchmaking condition logic:
      // - If both are random, they match.
      // - If both are specific filters, they must cross-match exactly (e.g. Female looking for Male matches Male looking for Female).
      // - A random filter CANNOT match with a specific filter.
      let peerMatchesUser = false;
      let userMatchesPeer = false;

      if (filter === 'random' && peer.filter === 'random') {
        peerMatchesUser = true;
        userMatchesPeer = true;
      } else if (filter !== 'random' && peer.filter !== 'random') {
        peerMatchesUser = peer.filter === userGender;
        userMatchesPeer = filter === peer.gender;
      } else {
        peerMatchesUser = false;
        userMatchesPeer = false;
      }

      if (peerMatchesUser && userMatchesPeer && peer.userId !== userId) {
        matchedPartner = peer;
        matchmakingQueue.splice(i, 1); // remove peer from queue
        break;
      }
    }

    if (matchedPartner) {
      // Create session
      const channelName = `play-${userId.substring(0, 8)}-${matchedPartner.userId.substring(0, 8)}-${Date.now()}`;
      
      // Setup default empty token for Agora AppID bypass mode (or signature if AppCert configured)
      const agoraToken = channelName; 

      // Fetch partner user details
      const partnerUser = await prisma.user.findUnique({
        where: { id: matchedPartner.userId }
      });

      // Save match state for user
      matchResults.set(userId, {
        channelName,
        agoraToken,
        partnerId: matchedPartner.userId,
        partnerName: partnerUser?.name || 'SikkaPlay Player',
        partnerUsername: partnerUser?.username || null,
        partnerGender: matchedPartner.gender
      });

      // Save match state for partner
      matchResults.set(matchedPartner.userId, {
        channelName,
        agoraToken,
        partnerId: userId,
        partnerName: user.name || 'SikkaPlay Player',
        partnerUsername: user.username || null,
        partnerGender: userGender
      });

      // Store call session history
      await prisma.playgroundSession.create({
        data: {
          channelName,
          userOneId: userId,
          userTwoId: matchedPartner.userId
        }
      });

      res.status(200).json({
        success: true,
        status: 'matched',
        channelName,
        agoraToken,
        agoraAppId: process.env.AGORA_APP_ID || 'test-app-id',
        partner: matchResults.get(userId)
      });
    } else {
      // Add user to queue
      matchmakingQueue.push(queuedUser);

      res.status(200).json({
        success: true,
        status: 'searching',
        message: 'Looking for matching partners...'
      });
    }
  } catch (error) {
    console.error('Error starting matchmaking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 8. Matchmaking Status Check
export const checkMatchmakingStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const matchInfo = matchResults.get(userId);
    if (matchInfo) {
      // Pop match result once fetched
      matchResults.delete(userId);

      res.status(200).json({
        success: true,
        status: 'matched',
        channelName: matchInfo.channelName,
        agoraToken: matchInfo.agoraToken,
        agoraAppId: process.env.AGORA_APP_ID || 'test-app-id',
        partner: matchInfo
      });
    } else {
      // Confirm still queued
      const isQueued = matchmakingQueue.some(q => q.userId === userId);
      res.status(200).json({
        success: true,
        status: isQueued ? 'searching' : 'idle'
      });
    }
  } catch (error) {
    console.error('Error checking matchmaking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 9. Fetch Friends list
export const getFriendsList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const friendships = await prisma.friendship.findMany({
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
      const friendUser = await prisma.user.findUnique({
        where: { id: friendId }
      });

      if (friendUser) {
        const ids = [userId, friendUser.id].sort();
        const channelName = `private-chat-${ids[0]}-${ids[1]}`;

        const lastMessage = await prisma.playgroundMessage.findFirst({
          where: { channelName },
          orderBy: { createdAt: 'desc' }
        });

        const unreadCount = await prisma.playgroundMessage.count({
          where: {
            channelName,
            senderId: friendUser.id,
            isSeen: false
          }
        });

        const item = {
          friendshipId: f.id,
          id: friendUser.id,
          name: friendUser.name || 'Friend',
          gender: friendUser.gender,
          username: friendUser.username,
          createdAt: f.createdAt,
          isOnline: onlineUsersCache.has(friendUser.id),
          lastMessageText: lastMessage ? lastMessage.text : null,
          lastMessageTime: lastMessage ? lastMessage.createdAt : null,
          unreadCount
        };

        if (f.status === 'ACCEPTED') {
          friends.push(item);
        } else if (f.status === 'PENDING') {
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
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 10. Friends lookup search
export const searchFriends = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const matches = await prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
          isPhoneNumber ? { phoneNumber: encrypt(query.trim()) } : undefined
        ].filter(Boolean) as any
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
  } catch (error) {
    console.error('Error searching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 11. Send Friend Request
export const sendFriendRequest = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const existing = await prisma.friendship.findUnique({
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

    const friendship = await prisma.friendship.create({
      data: {
        userOneId: u1,
        userTwoId: u2,
        status: 'PENDING',
        actionUserId: userId
      }
    });

    // Send push notification to target user
    const sender = await prisma.user.findUnique({ where: { id: userId } });
    const senderName = sender?.name || sender?.username || 'SikkaPlay User';
    const recipientUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (recipientUser?.fcmToken) {
      await sendPushNotification(
        recipientUser.fcmToken,
        'New Friend Request',
        `${senderName} sent you a friend request!`,
        'friend_request',
        null,
        userId
      );
    }

    res.status(200).json({
      success: true,
      friendship,
      message: 'Friend request sent successfully.'
    });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 12. Accept Friend Request
export const acceptFriendRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { friendshipId } = req.body;

    if (!userId || !friendshipId) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    const f = await prisma.friendship.findUnique({
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

    const updated = await prisma.friendship.update({
      where: { id: friendshipId },
      data: {
        status: 'ACCEPTED'
      }
    });

    // Send push notification to target user (the one who sent the request)
    const targetUserId = updated.userOneId === userId ? updated.userTwoId : updated.userOneId;
    const acceptor = await prisma.user.findUnique({ where: { id: userId } });
    const acceptorName = acceptor?.name || acceptor?.username || 'SikkaPlay User';
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (targetUser?.fcmToken) {
      await sendPushNotification(
        targetUser.fcmToken,
        'Friend Request Accepted',
        `${acceptorName} accepted your friend request!`,
        'friend_accept',
        null,
        userId
      );
    }

    res.status(200).json({
      success: true,
      friendship: updated,
      message: 'Friend request accepted.'
    });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 13. Send Virtual Gift
export const sendVirtualGift = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { receiverId, giftName } = req.body;

    if (!userId || !receiverId || !giftName) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    const gift = await prisma.gift.findFirst({
      where: { name: giftName }
    });

    if (!gift) {
      res.status(404).json({ error: 'Gift type not found' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      });

      if (!sender) throw new Error('Sender user not found');
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
  } catch (error: any) {
    console.error('Error sending virtual gift:', error);
    res.status(400).json({ error: error.message || 'Internal server error' });
  }
};

// 14. Sell Virtual Gift (Redeem for coins)
export const sellVirtualGift = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { giftId } = req.body;

    if (!userId || !giftId) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    const owned = await prisma.userGiftInventory.findUnique({
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
    const config = await prisma.appConfig.findFirst();
    const commRate = config?.giftCommissionRate ?? 0.20; // default 20%
    const payoutCoins = Math.floor(owned.gift.coinsPrice * (1 - commRate));

    const result = await prisma.$transaction(async (tx) => {
      // Decrement inventory
      if (owned.count === 1) {
        await tx.userGiftInventory.delete({
          where: { id: owned.id }
        });
      } else {
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
  } catch (error) {
    console.error('Error selling virtual gift:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 15. Submit Report & Auto-Block
export const reportUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId; // reporter
    const { reportedUserId, reason } = req.body;

    if (!userId || !reportedUserId || !reason) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    // Record report
    await prisma.playgroundReport.create({
      data: {
        reporterId: userId,
        reportedId: reportedUserId,
        reason
      }
    });

    // Check count of reports received today (last 24 hours)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const reportCount = await prisma.playgroundReport.count({
      where: {
        reportedId: reportedUserId,
        createdAt: { gte: twentyFourHoursAgo }
      }
    });

    let autoBanned = false;
    let banExpiresAt: Date | null = null;

    if (reportCount >= 3) {
      // Auto-ban sandbox rule: 24 hour suspension
      banExpiresAt = new Date();
      banExpiresAt.setHours(banExpiresAt.getHours() + 24);

      await prisma.playgroundBan.create({
        data: {
          userId: reportedUserId,
          expiresAt: banExpiresAt,
          reason: `Auto-suspended: Accumulated ${reportCount} reports within rolling 24 hours.`
        }
      });

      // Block match queued state
      const idx = matchmakingQueue.findIndex(q => q.userId === reportedUserId);
      if (idx !== -1) {
        matchmakingQueue.splice(idx, 1);
      }

      autoBanned = true;
      console.log(`[SAFETY WARNING] User ${reportedUserId} auto-banned until ${banExpiresAt} due to ${reportCount} reports.`);
    }

    res.status(200).json({
      success: true,
      message: 'Report submitted successfully. Thank you for keeping the playground safe!',
      autoBanned,
      banExpiresAt
    });
  } catch (error) {
    console.error('Error reporting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 16. Send Playground Message (Temporary Polling Buffer with FCM Push notification fallback)
export const sendPlaygroundMessage = async (req: AuthRequest, res: Response): Promise<void> => {
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
          await prisma.playgroundMessage.update({
            where: { id: msgId },
            data: { reaction: emoji }
          });
        } catch (err) {
          console.error('Failed to update reaction in DB:', err);
        }
      }
    }

    const msg = await prisma.playgroundMessage.create({
      data: {
        channelName: finalChannelName,
        senderId,
        text
      }
    });

    // Check if recipient is active in the same channel. If not, send push notification
    if (recipientId && typeof recipientId === 'string') {
      const activeChannel = userActiveChannelCache.get(recipientId);
      if (activeChannel !== finalChannelName) {
        // Recipient is not viewing this channel - send push!
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const senderName = sender?.name || sender?.username || 'SikkaPlay User';

        const recipientUser = await prisma.user.findUnique({ where: { id: recipientId } });
        if (recipientUser?.fcmToken) {
          const isSignaling = text.startsWith('__');
          if (!isSignaling) {
            await sendPushNotification(
              recipientUser.fcmToken,
              `Message from ${senderName}`,
              text.startsWith('[Reply to:') ? text.split('\n').slice(1).join('\n') : text,
              'playground_chat',
              null,
              recipientId,
              false,
              senderId
            );
          }
        }
      }
    }

    res.status(200).json({ success: true, message: msg });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 17. Sync Playground Messages (Seen verify & 24 Hours Retention approach)
export const syncPlaygroundMessages = async (req: AuthRequest, res: Response): Promise<void> => {
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

    let finalChannelName = channelName;
    if (recipientId && typeof recipientId === 'string' && (channelName.startsWith('friend-chat-') || channelName.startsWith('private-chat-') || channelName.startsWith('friend-') || channelName.startsWith('private-'))) {
      const ids = [userId, recipientId].sort();
      finalChannelName = `private-chat-${ids[0]}-${ids[1]}`;
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Global cleanup of messages older than 24 hours
    await prisma.playgroundMessage.deleteMany({
      where: {
        createdAt: { lt: twentyFourHoursAgo }
      }
    });

    let messages = [];
    let outgoing = [];

    if (history === 'true') {
      // Fetch full history from the last 24 hours
      messages = await prisma.playgroundMessage.findMany({
        where: {
          channelName: finalChannelName,
          createdAt: { gte: twentyFourHoursAgo }
        },
        orderBy: { createdAt: 'asc' }
      });

      // Mark any unread incoming messages in history as seen
      const unreadIncoming = messages.filter(m => m.senderId !== userId && !m.isSeen);
      if (unreadIncoming.length > 0) {
        await prisma.playgroundMessage.updateMany({
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
    } else {
      // Normal sync: fetch only unread incoming messages
      messages = await prisma.playgroundMessage.findMany({
        where: {
          channelName: finalChannelName,
          senderId: { not: userId },
          isSeen: false
        },
        orderBy: { createdAt: 'asc' }
      });

      // Mark incoming messages as seen
      if (messages.length > 0) {
        await prisma.playgroundMessage.updateMany({
          where: { id: { in: messages.map(m => m.id) } },
          data: { isSeen: true }
        });
      }

      // Fetch outgoing messages from the last 24 hours to return their seen status
      outgoing = await prisma.playgroundMessage.findMany({
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
      partnerOnline = onlineUsersCache.has(recipientId);
      const typingKey = `${finalChannelName}:${recipientId}`;
      partnerIsTyping = typingUsersCache.has(typingKey);
    }

    const totalDbCount = await prisma.playgroundMessage.count({
      where: { channelName: finalChannelName }
    });

    res.status(200).json({
      success: true,
      messages,
      outgoingStatus: outgoing.map(o => ({ id: o.id, isSeen: o.isSeen })),
      partnerOnline,
      partnerIsTyping,
      totalDbCount
    });
  } catch (error) {
    console.error('Error syncing messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 17b. Heartbeat active channel tracking
export const updateActiveChannel = async (req: AuthRequest, res: Response): Promise<void> => {
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
      userActiveChannelCache.set(userId, finalChannelName);
    } else {
      userActiveChannelCache.del(userId);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating active channel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 18. Update personal Bio description
export const updateBio = async (req: AuthRequest, res: Response): Promise<void> => {
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

    await prisma.user.update({
      where: { id: userId },
      data: { bio: cleanBio || null }
    });

    res.status(200).json({ success: true, message: 'Bio updated successfully' });
  } catch (error) {
    console.error('Error updating bio:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 19. Get Public Profile details by username
export const getPublicProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { username } = req.query;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username parameter is required' });
      return;
    }

    const targetUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() }
    });

    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check friendship status between current user and target user
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userOneId: userId, userTwoId: targetUser.id },
          { userOneId: targetUser.id, userTwoId: userId }
        ]
      }
    });

    let friendshipState = 'NONE'; // 'NONE' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'FRIENDS'
    let friendshipId: string | null = null;

    if (friendship) {
      friendshipId = friendship.id;
      if (friendship.status === 'ACCEPTED') {
        friendshipState = 'FRIENDS';
      } else if (friendship.status === 'PENDING') {
        if (friendship.actionUserId === userId) {
          friendshipState = 'PENDING_SENT';
        } else {
          friendshipState = 'PENDING_RECEIVED';
        }
      }
    }

    // Calculate level based on total earned coins
    const level = Math.floor((targetUser.totalEarned) / 1000) + 1;

    // Fetch friend count (ACCEPTED status)
    const friendCount = await prisma.friendship.count({
      where: {
        status: 'ACCEPTED',
        OR: [
          { userOneId: targetUser.id },
          { userTwoId: targetUser.id }
        ]
      }
    });

    // Fetch total gifts received (count of all-time GiftTransactions received)
    const totalGiftsReceived = await prisma.giftTransaction.count({
      where: { receiverId: targetUser.id }
    });

    res.status(200).json({
      success: true,
      user: {
        id: targetUser.id,
        name: targetUser.name || 'SikkaPlay Player',
        username: targetUser.username,
        gender: targetUser.gender || 'male',
        level,
        totalEarned: targetUser.totalEarned,
        bio: targetUser.bio || 'Hello! I am using SikkaPlay.',
        friendshipState,
        friendshipId,
        friendCount,
        totalGiftsReceived
      }
    });
  } catch (error) {
    console.error('Error fetching public profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 15b. Unfriend (Delete friendship and wipe private chat history)
export const unfriendUser = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const deletedFriendship = await prisma.friendship.deleteMany({
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

    // Delete chat messages between these two users (private chat history wipe)
    // First construct the unified channel name for private chat
    const ids = [userId, targetUserId].sort();
    const unifiedChannelName = `private-chat-${ids[0]}-${ids[1]}`;

    await prisma.playgroundMessage.deleteMany({
      where: {
        channelName: unifiedChannelName
      }
    });

    res.status(200).json({ success: true, message: 'Unfriended successfully' });
  } catch (error) {
    console.error('Error unfriending user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 16b. Clear chat history for a private channel without unfriending
export const clearChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
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

    await prisma.playgroundMessage.deleteMany({
      where: {
        channelName: unifiedChannelName
      }
    });

    res.status(200).json({ success: true, message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 23. Update typing status
export const setTypingStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { channelName, isTyping } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!channelName) {
      res.status(400).json({ error: 'channelName is required' });
      return;
    }

    const cacheKey = `${channelName}:${userId}`;
    if (isTyping === true) {
      typingUsersCache.set(cacheKey, true);
    } else {
      typingUsersCache.del(cacheKey);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in setTypingStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
