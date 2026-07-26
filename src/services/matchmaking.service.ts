import { redisClient } from '../config/redis';
import { Server, Socket } from 'socket.io';
import { prisma } from '../config/db';

export type UserState = 'IDLE' | 'SEARCHING' | 'MATCH_FOUND' | 'MATCHED' | 'CHATTING' | 'OFFLINE';

export interface MatchmakerSession {
  userId: string;
  gender: 'male' | 'female' | 'random';
  preference: 'male' | 'female' | 'random';
  status: UserState;
  joinedAt: number;
  socketId: string;
  roomId: string | null;
  locked: boolean;
  lastHeartbeat: number;
}

const QUEUES = {
  male: 'matchmaking:queue:male',
  female: 'matchmaking:queue:female',
  random: 'matchmaking:queue:random',
};

export class MatchmakingService {
  private io: Server;
  private workerInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(io: Server) {
    this.io = io;
  }

  public async startWorker() {
    console.log('[Matchmaking Worker] Started');
    // Process matchmaking every 2 seconds
    this.workerInterval = setInterval(() => this.processQueues(), 2000);
    // Process heartbeats every 5 seconds
    this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), 5000);
    
    // Clear queues on restart
    await redisClient.del(QUEUES.male, QUEUES.female, QUEUES.random);
  }

  public async stopWorker() {
    if (this.workerInterval) clearInterval(this.workerInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }

  // --- STATE MANAGEMENT ---

  public async getUserState(userId: string): Promise<MatchmakerSession | null> {
    const data = await redisClient.get(`user:state:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  public async setUserState(userId: string, session: MatchmakerSession) {
    await redisClient.set(`user:state:${userId}`, JSON.stringify(session));
  }

  public async removeUserState(userId: string) {
    await redisClient.del(`user:state:${userId}`);
  }

  // --- CORE ACTIONS ---

  public async joinSearch(userId: string, socketId: string, gender: 'male' | 'female' | 'random', preference: 'male' | 'female' | 'random') {
    let state = await this.getUserState(userId);
    if (state && state.status !== 'IDLE' && state.status !== 'OFFLINE') {
      throw new Error('Already searching or chatting.');
    }

    // Check if user is blocked or banned
    const ban = await prisma.playgroundBan.findFirst({
      where: {
        userId,
        expiresAt: { gte: new Date() }
      }
    });

    if (ban) {
      throw new Error(`Matchmaking suspended until ${ban.expiresAt.toLocaleString()} due to reports.`);
    }

    // Check coin balance for premium filters
    const config = await prisma.appConfig.findFirst();
    let filterCost = 0;
    if (preference === 'male') filterCost = config?.playgroundMaleFilterCost ?? 50;
    else if (preference === 'female') filterCost = config?.playgroundFemaleFilterCost ?? 50;

    if (filterCost > 0) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.balance < filterCost) {
        throw new Error(`Insufficient Sikka Coins. Premium filter costs ${filterCost} coins.`);
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
            description: `Deducted premium matchmaking filter cost (${preference} filter)`
          }
        });
      });
    }

    state = {
      userId,
      gender,
      preference,
      status: 'SEARCHING',
      joinedAt: Date.now(),
      socketId,
      roomId: null,
      locked: false,
      lastHeartbeat: Date.now(),
    };

    await this.setUserState(userId, state);
    await redisClient.rpush(QUEUES[gender], userId);
  }

  public async cancelSearch(userId: string) {
    const state = await this.getUserState(userId);
    if (!state || state.status !== 'SEARCHING') return;

    // Refund Logic
    const config = await prisma.appConfig.findFirst();
    let filterCost = 0;
    if (state.preference === 'male') filterCost = config?.playgroundMaleFilterCost ?? 50;
    else if (state.preference === 'female') filterCost = config?.playgroundFemaleFilterCost ?? 50;

    if (filterCost > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: filterCost } }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: filterCost,
            type: 'playground',
            status: 'success',
            description: `Refunded premium matchmaking filter cost (${state.preference} filter)`
          }
        });
      });
    }

    await redisClient.lrem(QUEUES[state.gender], 0, userId);
    state.status = 'IDLE';
    await this.setUserState(userId, state);
  }

  public async updateHeartbeat(userId: string) {
    const state = await this.getUserState(userId);
    if (state) {
      state.lastHeartbeat = Date.now();
      await this.setUserState(userId, state);
    }
  }

  public async handleDisconnect(userId: string) {
    const state = await this.getUserState(userId);
    if (!state) return;
    console.log(`[Matchmaking] Handling disconnect for user ${userId}, status: ${state.status}`);
    if (state.status === 'SEARCHING') {
      await redisClient.lrem(QUEUES[state.gender], 0, userId);
      await this.removeUserState(userId);
    } else if (state.status === 'CHATTING') {
      await this.leaveChat(userId);
      await this.removeUserState(userId);
    }
  }

  // --- WORKER LOGIC ---

  private async processQueues() {
    // Basic logic: We iterate over male queue and try to find matches in female or random queues based on preference.
    // To prevent race conditions across multiple nodes, we use a single Redis script, or we acquire a lock.
    // For simplicity, we process one match at a time per queue.
    
    await this.matchFromQueue('male');
    await this.matchFromQueue('female');
    await this.matchFromQueue('random');
  }

  private async matchFromQueue(queueType: 'male' | 'female' | 'random') {
    const queueKey = QUEUES[queueType];
    const users = await redisClient.lrange(queueKey, 0, -1);
    
    for (const userId of users) {
      const userState = await this.getUserState(userId);
      if (!userState || userState.status !== 'SEARCHING' || userState.locked) continue;

      // Find compatible partner
      const partner = await this.findCompatiblePartner(userState);
      if (partner) {
        // Lock both
        const lockedUser = await this.lockUser(userState.userId);
        const lockedPartner = await this.lockUser(partner.userId);

        if (lockedUser && lockedPartner) {
          // Remove from queues
          await redisClient.lrem(QUEUES[userState.gender], 0, userState.userId);
          await redisClient.lrem(QUEUES[partner.gender], 0, partner.userId);

          // Create room
          await this.createMatch(userState, partner);
        } else {
          // Unlock if failed
          if (lockedUser) await this.unlockUser(userState.userId);
          if (lockedPartner) await this.unlockUser(partner.userId);
        }
      }
    }
  }

  private async findCompatiblePartner(user: MatchmakerSession): Promise<MatchmakerSession | null> {
    const targetQueueKey = user.preference === 'random' ? null : QUEUES[user.preference];
    
    // If preference is specific, search that queue. If random, search all.
    const queuesToSearch = targetQueueKey ? [targetQueueKey] : Object.values(QUEUES);

    for (const q of queuesToSearch) {
      const potentialPartners = await redisClient.lrange(q, 0, -1);
      for (const partnerId of potentialPartners) {
        if (partnerId === user.userId) continue;

        const partnerState = await this.getUserState(partnerId);
        if (!partnerState || partnerState.status !== 'SEARCHING' || partnerState.locked) continue;

        // Verify compatibility: Partner must accept User's gender
        const partnerAcceptsUser = partnerState.preference === 'random' || partnerState.preference === user.gender;
        const userAcceptsPartner = user.preference === 'random' || user.preference === partnerState.gender;

        if (partnerAcceptsUser && userAcceptsPartner) {
          return partnerState;
        }
      }
    }
    return null;
  }

  private async lockUser(userId: string): Promise<boolean> {
    const state = await this.getUserState(userId);
    if (!state || state.status !== 'SEARCHING' || state.locked) return false;
    
    // Atomically set lock (in a real high scale, use SETNX)
    state.locked = true;
    await this.setUserState(userId, state);
    return true;
  }

  private async unlockUser(userId: string) {
    const state = await this.getUserState(userId);
    if (state) {
      state.locked = false;
      await this.setUserState(userId, state);
    }
  }

  private async createMatch(user1: MatchmakerSession, user2: MatchmakerSession) {
    const roomId = `room-${user1.userId.substring(0, 8)}-${user2.userId.substring(0, 8)}-${Date.now()}`;
    
    user1.status = 'CHATTING';
    user1.roomId = roomId;
    user1.locked = false;
    
    user2.status = 'CHATTING';
    user2.roomId = roomId;
    user2.locked = false;

    await this.setUserState(user1.userId, user1);
    await this.setUserState(user2.userId, user2);

    // Save room state
    await redisClient.set(`room:${roomId}`, JSON.stringify({
      user1: user1.userId,
      user2: user2.userId,
      createdAt: Date.now()
    }));

    // Fetch user profiles from database
    const u1 = await prisma.user.findUnique({ where: { id: user1.userId } });
    const u2 = await prisma.user.findUnique({ where: { id: user2.userId } });

    // Generate Agora tokens or data
    const channelName = roomId;
    
    // Notify both with full profile details
    this.io.to(user1.socketId).emit('match_found', {
      partnerId: user2.userId,
      channelName,
      agoraToken: channelName,
      partnerName: u2?.name || 'SikkaPlay Player',
      partnerUsername: u2?.username || null,
      partnerAvatar: u2?.avatarUrl || null,
    });
    this.io.to(user2.socketId).emit('match_found', {
      partnerId: user1.userId,
      channelName,
      agoraToken: channelName,
      partnerName: u1?.name || 'SikkaPlay Player',
      partnerUsername: u1?.username || null,
      partnerAvatar: u1?.avatarUrl || null,
    });
  }

  public async leaveChat(userId: string) {
    const state = await this.getUserState(userId);
    if (!state || state.status !== 'CHATTING' || !state.roomId) return;

    const roomId = state.roomId;
    const roomData = await redisClient.get(`room:${roomId}`);
    if (!roomData) return;

    const room = JSON.parse(roomData);
    const partnerId = room.user1 === userId ? room.user2 : room.user1;

    // Reset both users
    await this.resetUserToIdle(userId);
    await this.resetUserToIdle(partnerId);

    // Delete room
    await redisClient.del(`room:${roomId}`);

    // Notify partner
    const partnerState = await this.getUserState(partnerId);
    if (partnerState && partnerState.socketId) {
      this.io.to(partnerState.socketId).emit('partner_left', { message: 'Partner left this chat.' });
      this.io.to(partnerState.socketId).emit('partner_left_chat', { message: 'Partner left this chat.' });
    }
  }

  private async resetUserToIdle(userId: string) {
    const state = await this.getUserState(userId);
    if (state) {
      state.status = 'IDLE';
      state.roomId = null;
      state.locked = false;
      await this.setUserState(userId, state);
    }
  }

  private async checkHeartbeats() {
    const keys = await redisClient.keys('user:state:*');
    const now = Date.now();
    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        const state: MatchmakerSession = JSON.parse(data);
        if (now - state.lastHeartbeat > 30000) { // 30 seconds
          // Dead user
          if (state.status === 'SEARCHING') {
            await redisClient.lrem(QUEUES[state.gender], 0, state.userId);
          } else if (state.status === 'CHATTING') {
            await this.leaveChat(state.userId);
          }
          await this.removeUserState(state.userId);
        }
      }
    }
  }
}
