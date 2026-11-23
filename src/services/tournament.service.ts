import { prisma } from '../config/db';
import crypto from 'crypto';
import { sendPushNotification, broadcastPushNotification } from './push.service';

interface LeaderboardCacheEntry {
  data: any;
  etag: string;
  cachedAt: number;
}

// In-memory cache for tournament leaderboards (15s TTL) to prevent DB egress & CPU spikes
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

// Cooldown map for overtake push notifications (max 1 alert per player per tournament every 15 mins)
const overtakeNotificationCooldown = new Map<string, number>();
const OVERTAKE_COOLDOWN_MS = 15 * 60 * 1000;


export class TournamentService {
  /**
   * Generates a cache key for a tournament's leaderboard request
   */
  private static getCacheKey(tournamentId: string, page: number, limit: number): string {
    return `${tournamentId}:${page}:${limit}`;
  }

  /**
   * Records a user's earned coins as tournament points into their participant record.
   * Atomic, rate-limit protected, and verifies tournament status & end time cutoff.
   */
  public static async recordTournamentScore(params: {
    userId: string;
    tournamentId: string;
    coinsEarned: number;
    gameType: string;
    tx?: any;
  }): Promise<{ scored: boolean; pointsAwarded: number; newScore?: number }> {
    const { userId, tournamentId, coinsEarned, gameType, tx } = params;
    const db = tx || prisma;

    if (!tournamentId || !userId || coinsEarned <= 0) {
      return { scored: false, pointsAwarded: 0 };
    }

    try {
      const tournament = await db.tournament.findUnique({
        where: { id: tournamentId }
      });

      if (!tournament) {
        return { scored: false, pointsAwarded: 0 };
      }

      // 1. Strict status & time cutoff check
      const now = new Date();
      if (tournament.status !== 'LIVE' || now < tournament.startTime || now > tournament.endTime) {
        return { scored: false, pointsAwarded: 0 };
      }

      // 2. Allowed games check
      if (tournament.allowedGames && tournament.allowedGames.length > 0) {
        if (!tournament.allowedGames.includes(gameType)) {
          return { scored: false, pointsAwarded: 0 };
        }
      }

      // 3. Verify user is enrolled
      const participant = await db.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId,
            userId
          }
        },
        include: {
          user: {
            select: {
              name: true,
              username: true
            }
          }
        }
      });

      if (!participant) {
        return { scored: false, pointsAwarded: 0 };
      }

      // 4. Calculate points with multiplier
      const multiplier = tournament.scoreMultiplier || 1.0;
      const points = Math.max(0, Math.floor(coinsEarned * multiplier));

      if (points <= 0) {
        return { scored: false, pointsAwarded: 0 };
      }

      // Snapshot top 3 podium before score increment to detect outranking/overtake
      let topPodiumBefore: any[] = [];
      try {
        topPodiumBefore = await db.tournamentParticipant.findMany({
          where: { tournamentId },
          orderBy: [
            { score: 'desc' },
            { lastScoreUpdatedAt: 'asc' }
          ],
          take: 3,
          select: {
            userId: true,
            score: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                fcmToken: true
              }
            }
          }
        });
      } catch (podiumErr) {
        console.error('[TournamentService] Failed to snapshot topPodiumBefore:', podiumErr);
      }

      // 5. Update participant score and tie-breaker timestamp atomically
      const updated = await db.tournamentParticipant.update({
        where: {
          tournamentId_userId: {
            tournamentId,
            userId
          }
        },
        data: {
          score: { increment: points },
          lastScoreUpdatedAt: now
        }
      });

      // Trigger Overtake push notification check asynchronously (non-blocking)
      const scorerName = participant.user?.name || participant.user?.username || 'A player';
      TournamentService.checkAndNotifyOutrankedPlayers({
        tournament,
        scorerUserId: userId,
        scorerName,
        oldScore: participant.score,
        newScore: updated.score,
        topPodiumBefore
      }).catch(err => console.error('[TournamentService] Error in overtake notification trigger:', err));

      // Invalidate leaderboard in-memory cache for this tournament
      for (const key of leaderboardCache.keys()) {
        if (key.startsWith(`${tournamentId}:`) || key.startsWith(`lb_${tournamentId}_`)) {
          leaderboardCache.delete(key);
        }
      }

      return { scored: true, pointsAwarded: points, newScore: updated.score };
    } catch (error) {
      console.error(`[TournamentService.recordTournamentScore] Error recording score for user ${userId} in tournament ${tournamentId}:`, error);
      return { scored: false, pointsAwarded: 0 };
    }
  }

  /**
   * Fetches the leaderboard with in-memory 15-second caching and ETag support.
   */
  public static async getLeaderboard(params: {
    tournamentId: string;
    userId?: string;
    page?: number;
    limit?: number;
    ifNoneMatch?: string;
  }): Promise<{
    data: any;
    etag: string;
    isNotModified: boolean;
  }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(10, params.limit || 50));
    const cacheKey = this.getCacheKey(params.tournamentId, page, limit);
    const now = Date.now();

    let cached = leaderboardCache.get(cacheKey);

    if (!cached || now - cached.cachedAt > CACHE_TTL_MS) {
      // Cache miss or expired: fetch from DB using covering composite index
      const skip = (page - 1) * limit;

      const [tournament, participants, totalCount] = await Promise.all([
        prisma.tournament.findUnique({
          where: { id: params.tournamentId },
          select: {
            id: true,
            title: true,
            prizePool: true,
            prizePoolRupees: true,
            status: true,
            startTime: true,
            endTime: true,
            allowedGames: true,
            prizeStructure: true,
            minPointsToWin: true,
            tag: true
          }
        }),
        prisma.tournamentParticipant.findMany({
          where: { tournamentId: params.tournamentId },
          orderBy: [
            { score: 'desc' },
            { lastScoreUpdatedAt: 'asc' }
          ],
          skip,
          take: limit,
          select: {
            userId: true,
            score: true,
            lastScoreUpdatedAt: true,
            user: {
              select: {
                name: true,
                username: true,
                avatarUrl: true
              }
            }
          }
        }),
        prisma.tournamentParticipant.count({
          where: { tournamentId: params.tournamentId }
        })
      ]);

      const prizeStructure = Array.isArray(tournament?.prizeStructure)
        ? (tournament!.prizeStructure as Array<{ rankMin: number; rankMax: number; prize: number }>)
        : [];
      const minRequired = (tournament as any)?.minPointsToWin ?? 1000;

      // Format clean, comprehensive JSON response
      const rankings = participants.map((p, idx) => {
        const rank = skip + idx + 1;
        const matchingTier = prizeStructure.find((t) => rank >= t.rankMin && rank <= t.rankMax);
        const name = p.user?.name || p.user?.username || `Player_${p.userId.substring(0, 4)}`;
        const avatar = p.user?.avatarUrl || null;
        const meetsThreshold = p.score >= minRequired;

        return {
          rank,
          userId: p.userId,
          name,
          userName: name,
          username: p.user?.username || null,
          avatarUrl: avatar,
          userAvatar: avatar,
          score: p.score,
          prize: (matchingTier && meetsThreshold) ? matchingTier.prize : 0,
          potentialPrize: matchingTier ? matchingTier.prize : 0,
          isEligibleForPrize: meetsThreshold,
          minPointsRequired: minRequired
        };
      });

      const payload = {
        tournament: tournament ? {
          id: tournament.id,
          title: tournament.title,
          rawTitle: tournament.title,
          tag: tournament.tag,
          prizePool: tournament.prizePool,
          prizePoolRupees: tournament.prizePoolRupees || 0,
          status: tournament.status,
          startTime: tournament.startTime,
          endTime: tournament.endTime,
          allowedGames: tournament.allowedGames,
          prizeStructure: tournament.prizeStructure,
          minPointsToWin: minRequired,
        } : null,
        rankings,
        leaderboard: rankings,
        totalParticipants: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        isLive: tournament?.status === 'LIVE'
      };

      const etag = crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex');

      cached = {
        data: payload,
        etag,
        cachedAt: now
      };

      leaderboardCache.set(cacheKey, cached);
    }

    // Check If-None-Match header for 304 Not Modified
    if (params.ifNoneMatch && params.ifNoneMatch === cached.etag) {
      return {
        data: null,
        etag: cached.etag,
        isNotModified: true
      };
    }

    // Also get requesting user's live rank & score if authenticated
    let userStanding: any = null;
    if (params.userId) {
      const myParticipant = await prisma.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: params.tournamentId,
            userId: params.userId
          }
        },
        include: {
          user: {
            select: {
              name: true,
              username: true,
              avatarUrl: true
            }
          }
        }
      });

      if (myParticipant) {
        // Count users with higher score, or equal score but earlier timestamp
        const higherRankedCount = await prisma.tournamentParticipant.count({
          where: {
            tournamentId: params.tournamentId,
            OR: [
              { score: { gt: myParticipant.score } },
              {
                score: myParticipant.score,
                lastScoreUpdatedAt: { lt: myParticipant.lastScoreUpdatedAt }
              }
            ]
          }
        });

        const rank = higherRankedCount + 1;
        const prizeStructure = Array.isArray(cached?.data?.tournament?.prizeStructure)
          ? (cached!.data.tournament.prizeStructure as Array<{ rankMin: number; rankMax: number; prize: number }>)
          : [];
        const matchingTier = prizeStructure.find((t) => rank >= t.rankMin && rank <= t.rankMax);
        const name = myParticipant.user?.name || myParticipant.user?.username || 'You';
        const avatar = myParticipant.user?.avatarUrl || null;

        userStanding = {
          rank,
          userId: params.userId,
          name,
          userName: name,
          username: myParticipant.user?.username || null,
          avatarUrl: avatar,
          userAvatar: avatar,
          score: myParticipant.score,
          prize: matchingTier ? matchingTier.prize : 0,
          lastScoreUpdatedAt: myParticipant.lastScoreUpdatedAt
        };
      }
    }

    return {
      data: {
        ...cached.data,
        userStanding,
        userRank: userStanding
      },
      etag: cached.etag,
      isNotModified: false
    };
  }

  /**
   * Automated Prize Distribution Engine:
   * Resolves winners against prizeStructure JSON, credits wallet balances, records transactions, and sends notifications.
   */
  public static async distributePrizesForTournament(tournamentId: string): Promise<boolean> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      });

      if (!tournament || tournament.isPrizesDistributed) {
        return false;
      }

      const prizeStructure = Array.isArray(tournament.prizeStructure)
        ? (tournament.prizeStructure as Array<{ rankMin: number; rankMax: number; prize: number }>)
        : [];

      if (prizeStructure.length === 0) {
        await prisma.tournament.update({
          where: { id: tournamentId },
          data: { isPrizesDistributed: true }
        });
        return true;
      }

      // Fetch all participants ranked by score DESC, then earliest timestamp ASC
      const rankedParticipants = await prisma.tournamentParticipant.findMany({
        where: { tournamentId },
        orderBy: [
          { score: 'desc' },
          { lastScoreUpdatedAt: 'asc' }
        ],
        select: {
          userId: true,
          score: true,
          user: {
            select: {
              fcmToken: true
            }
          }
        }
      });

      const winnersToNotify: Array<{ userId: string; fcmToken: string | null; rank: number; prize: number }> = [];

      // Process in batches / atomic transaction
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < rankedParticipants.length; i++) {
          const rank = i + 1;
          const participant = rankedParticipants[i];

          // Find if this rank falls into any prize tier
          const matchingTier = prizeStructure.find((tier) => rank >= tier.rankMin && rank <= tier.rankMax);

          // Minimum points threshold check: User must score at least minPointsToWin (e.g. 1000) to receive reward
          const minRequired = (tournament as any).minPointsToWin ?? 1000;
          const meetsThreshold = participant.score >= minRequired;

          if (matchingTier && matchingTier.prize > 0 && meetsThreshold) {
            const prizeAmount = matchingTier.prize;

            // 1. Credit wallet
            await tx.user.update({
              where: { id: participant.userId },
              data: {
                balance: { increment: prizeAmount },
                totalEarned: { increment: prizeAmount }
              }
            });

            // 2. Ledger Transaction
            await tx.transaction.create({
              data: {
                userId: participant.userId,
                amount: prizeAmount,
                type: 'tournament_prize',
                status: 'success',
                description: `Rank #${rank} in ${tournament.title}`
              }
            });

            // 3. Prize Winner Record
            await tx.tournamentPrizeWinner.create({
              data: {
                tournamentId,
                userId: participant.userId,
                rank,
                score: participant.score,
                prizeCoins: prizeAmount
              }
            });

            winnersToNotify.push({
              userId: participant.userId,
              fcmToken: participant.user.fcmToken,
              rank,
              prize: prizeAmount
            });
          }
        }

        // Mark tournament prizes distributed
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { isPrizesDistributed: true }
        });
      });

      // Dispatch notifications asynchronously
      for (const winner of winnersToNotify) {
        if (winner.fcmToken) {
          sendPushNotification(
            winner.fcmToken,
            `🏆 Congratulations! You Won!`,
            `You achieved Rank #${winner.rank} in "${tournament.title}" and won ${winner.prize} Coins! Check your wallet.`,
            'tournament_winner',
            tournament.bannerUrl || null,
            winner.userId
          ).catch((e) => console.error('Error sending prize push notification:', e));
        }
      }

      console.log(`[TournamentService] Distributed prizes for tournament ${tournamentId} to ${winnersToNotify.length} winners.`);
      return true;
    } catch (error) {
      console.error(`[TournamentService] Error distributing prizes for tournament ${tournamentId}:`, error);
      return false;
    }
  }

  /**
   * Lifecycle State Transition Engine (invoked by Cron every minute):
   * Transitions UPCOMING -> LIVE, LIVE -> COMPLETED, and triggers prize distribution.
   */
  /**
   * Lifecycle State Transition Engine (invoked by Cron every minute):
   * Transitions UPCOMING -> LIVE, LIVE -> COMPLETED, triggers prize distribution,
   * and automatically broadcasts Start & End push notifications to all users.
   */
  public static async processLifecycleTransitions(): Promise<void> {
    const now = new Date();

    try {
      // 1. Auto-transition tournaments from UPCOMING to LIVE when startTime arrives
      const config = await prisma.appConfig.findFirst({
        select: {
          isTournamentsEnabled: true,
          isRecurringTournamentsEnabled: true
        }
      });

      const isTournamentsMasterEnabled = config ? config.isTournamentsEnabled !== false : true;
      const isRecurringEnabled = config ? config.isRecurringTournamentsEnabled !== false : true;

      if (isTournamentsMasterEnabled) {
        const toLive = await prisma.tournament.findMany({
          where: {
            status: 'UPCOMING',
            startTime: { lte: now },
            endTime: { gt: now },
            // If recurring tournaments are disabled, only activate non-recurring
            ...(isRecurringEnabled ? {} : { isRecurring: false })
          },
          select: { id: true, title: true }
        });

        for (const t of toLive) {
          await prisma.tournament.update({
            where: { id: t.id },
            data: { status: 'LIVE' }
          });
          console.log(`[TournamentService] Tournament "${t.title}" (${t.id}) transitioned to LIVE.`);
        }
      }

      // Expire any UPCOMING tournaments whose endTime has already passed
      const expiredUpcoming = await prisma.tournament.findMany({
        where: {
          status: 'UPCOMING',
          endTime: { lte: now }
        },
        select: { id: true, title: true, isRecurring: true }
      });
      for (const t of expiredUpcoming) {
        await prisma.tournament.update({
          where: { id: t.id },
          data: {
            status: t.isRecurring ? 'CANCELLED' : 'COMPLETED',
            isStartNotified: true,
            isEndNotified: true
          }
        });
        console.log(`[TournamentService] Expired UPCOMING tournament "${t.title}" (${t.id}) marked as ${t.isRecurring ? 'CANCELLED' : 'COMPLETED'}.`);
      }

      // 2. Broadcast Tournament START Push Notifications (for LIVE tournaments that haven't notified yet)
      const unnotifiedLiveTournaments = await prisma.tournament.findMany({
        where: {
          status: 'LIVE',
          isStartNotified: false,
          endTime: { gt: now }
        },
        select: { id: true, title: true, bannerUrl: true, prizePool: true, prizePoolRupees: true }
      });

      for (const t of unnotifiedLiveTournaments) {
        // Mark notified first to avoid race conditions across cron iterations
        await prisma.tournament.update({
          where: { id: t.id },
          data: { isStartNotified: true }
        });

        TournamentService.sendTournamentStartNotification(t).catch((err) =>
          console.error(`[TournamentService] Failed to send start notification for "${t.title}" (${t.id}):`, err)
        );
      }

      // 3. LIVE -> COMPLETED (Auto-transition when endTime has passed)
      const toComplete = await prisma.tournament.findMany({
        where: {
          status: 'LIVE',
          endTime: { lte: now }
        },
        select: { id: true, title: true }
      });

      for (const t of toComplete) {
        await prisma.tournament.update({
          where: { id: t.id },
          data: { status: 'COMPLETED' }
        });
        console.log(`[TournamentService] Tournament "${t.title}" (${t.id}) is now COMPLETED.`);

        // Trigger prize payout immediately
        await this.distributePrizesForTournament(t.id);
      }

      // 4. Re-check any COMPLETED tournaments where isPrizesDistributed is false
      const unrewarded = await prisma.tournament.findMany({
        where: {
          status: 'COMPLETED',
          isPrizesDistributed: false
        },
        select: { id: true }
      });

      for (const t of unrewarded) {
        await this.distributePrizesForTournament(t.id);
      }

      // 5. Broadcast Tournament END Push Notifications (with Top Rankers)
      const unnotifiedCompletedTournaments = await prisma.tournament.findMany({
        where: {
          status: 'COMPLETED',
          isEndNotified: false
        },
        select: { id: true, title: true, bannerUrl: true, prizePool: true, prizePoolRupees: true }
      });

      for (const t of unnotifiedCompletedTournaments) {
        // Mark notified first to prevent duplicate sends
        await prisma.tournament.update({
          where: { id: t.id },
          data: { isEndNotified: true }
        });

        TournamentService.sendTournamentEndNotification(t).catch((err) =>
          console.error(`[TournamentService] Failed to send end notification for "${t.title}" (${t.id}):`, err)
        );
      }
    } catch (error) {
      console.error('[TournamentService.processLifecycleTransitions] Error running lifecycle transitions:', error);
    }
  }

  /**
   * Broadcasts push notification when a tournament goes LIVE.
   */
  public static async sendTournamentStartNotification(tournament: {
    id: string;
    title: string;
    bannerUrl?: string | null;
    prizePool?: number;
    prizePoolRupees?: number;
  }): Promise<void> {
    try {
      const title = `🔥 Tournament Shuru Ho Chuka Hai!`;
      const body = `"${tournament.title}" shuru ho chuka hai! Jaldi join karo, der na ho jaye aur rewards jeeto! ⚡🏆`;

      console.log(`[TournamentService] Broadcasting Tournament START: "${tournament.title}" (${tournament.id})`);

      await broadcastPushNotification({
        title,
        body,
        type: 'tournament_start',
        bannerUrl: tournament.bannerUrl || null,
        tournamentId: tournament.id
      });
    } catch (error) {
      console.error(`[TournamentService.sendTournamentStartNotification] Error for ${tournament.id}:`, error);
    }
  }

  /**
   * Broadcasts push notification when a tournament ends, showing the Top Rankers & their ranks.
   */
  public static async sendTournamentEndNotification(tournament: {
    id: string;
    title: string;
    bannerUrl?: string | null;
    prizePool?: number;
    prizePoolRupees?: number;
  }): Promise<void> {
    try {
      // Fetch top 3 participants
      const topParticipants = await prisma.tournamentParticipant.findMany({
        where: { tournamentId: tournament.id },
        orderBy: [
          { score: 'desc' },
          { lastScoreUpdatedAt: 'asc' }
        ],
        take: 3,
        include: {
          user: {
            select: {
              name: true,
              username: true
            }
          }
        }
      });

      const getPlayerName = (p: any, rank: number) => {
        return p?.user?.name?.trim() || p?.user?.username?.trim() || `Player #${rank}`;
      };

      const title = `🏁 ${tournament.title} Ended!`;
      let body = '';

      if (topParticipants.length >= 3) {
        const p1 = getPlayerName(topParticipants[0], 1);
        const p2 = getPlayerName(topParticipants[1], 2);
        const p3 = getPlayerName(topParticipants[2], 3);
        body = `Tournament end ho gaya! 🏆 Top Rankers: 🥇 #1 ${p1}, 🥈 #2 ${p2}, 🥉 #3 ${p3}. Check full leaderboard & winnings! ⚡`;
      } else if (topParticipants.length === 2) {
        const p1 = getPlayerName(topParticipants[0], 1);
        const p2 = getPlayerName(topParticipants[1], 2);
        body = `Tournament end ho gaya! 🏆 Top Rankers: 🥇 #1 ${p1}, 🥈 #2 ${p2}. Check leaderboard & winnings! ⚡`;
      } else if (topParticipants.length === 1) {
        const p1 = getPlayerName(topParticipants[0], 1);
        const s1 = topParticipants[0].score;
        body = `Tournament end ho gaya! 🏆 Top Ranker: 🥇 #1 ${p1} (${s1} pts). Check full leaderboard & winnings! ⚡`;
      } else {
        body = `"${tournament.title}" end ho gaya hai! Check leaderboard aur agle tournament me hissa lo! ⚡`;
      }

      console.log(`[TournamentService] Broadcasting Tournament END: "${tournament.title}" (${tournament.id}) -> "${body}"`);

      await broadcastPushNotification({
        title,
        body,
        type: 'tournament_ended',
        bannerUrl: tournament.bannerUrl || null,
        tournamentId: tournament.id
      });
    } catch (error) {
      console.error(`[TournamentService.sendTournamentEndNotification] Error for ${tournament.id}:`, error);
    }
  }

  /**
   * Sends "Overtake Alert" push notification to players in Top 3 who were just surpassed.
   * Includes 15-minute rate-limiting cooldown per player to prevent spam.
   */
  private static async checkAndNotifyOutrankedPlayers(params: {
    tournament: any;
    scorerUserId: string;
    scorerName: string;
    oldScore: number;
    newScore: number;
    topPodiumBefore: Array<any>;
  }): Promise<void> {
    const { tournament, scorerUserId, scorerName, oldScore, newScore, topPodiumBefore } = params;
    if (!topPodiumBefore || topPodiumBefore.length === 0) return;

    // Must be LIVE and have at least 2 minutes remaining before tournament end
    const now = Date.now();
    const endTime = new Date(tournament.endTime).getTime();
    if (tournament.status !== 'LIVE' || endTime - now < 2 * 60 * 1000) {
      return;
    }

    // Clean up stale cooldowns if map grows large
    if (overtakeNotificationCooldown.size > 1000) {
      const staleCutoff = now - 30 * 60 * 1000;
      for (const [k, v] of overtakeNotificationCooldown.entries()) {
        if (v < staleCutoff) overtakeNotificationCooldown.delete(k);
      }
    }

    for (let i = 0; i < topPodiumBefore.length; i++) {
      const prevPlayer = topPodiumBefore[i];
      const prevUserId = prevPlayer.userId;
      const prevOldRank = i + 1; // 1, 2, or 3

      // Don't notify the scorer themselves
      if (prevUserId === scorerUserId) continue;

      // Check if scorer directly overtook this player:
      // Previously, scorer was <= player's score, now scorer is strictly > player's score
      if (oldScore <= prevPlayer.score && newScore > prevPlayer.score) {
        // Cooldown check (max 1 notification per player per tournament every 15 minutes)
        const cooldownKey = `${tournament.id}_${prevUserId}`;
        const lastSent = overtakeNotificationCooldown.get(cooldownKey) || 0;
        if (now - lastSent < OVERTAKE_COOLDOWN_MS) {
          continue;
        }

        const fcmToken = prevPlayer.user?.fcmToken;
        if (!fcmToken) continue;

        overtakeNotificationCooldown.set(cooldownKey, now);

        let alertTitle = '⚠️ Overtake Alert! ⚔️';
        let alertMsg = '';
        if (prevOldRank === 1) {
          alertTitle = '⚠️ Rank #1 Snatched! ⚔️';
          alertMsg = `${scorerName} ne aapko peeche chhod kar Rank #1 le liya in "${tournament.title}". Turant khelo aur apna #1 spot wapas pao! 🏆`;
        } else if (prevOldRank === 2) {
          alertTitle = '⚠️ Rank #2 Snatched! ⚔️';
          alertMsg = `${scorerName} ne aapko peeche kar diya in "${tournament.title}". Turant khelo aur wapas podium par aao! ⚔️`;
        } else {
          alertTitle = '⚠️ Top 3 Alert! ⚔️';
          alertMsg = `${scorerName} ne aapko Top 3 Podium se bahar kar diya in "${tournament.title}". Khelo aur apni winning rank wapas pao! 🏆`;
        }

        console.log(`[TournamentService] Overtake push sent to user ${prevUserId} (was Rank #${prevOldRank}) by ${scorerName}`);

        sendPushNotification(
          fcmToken,
          alertTitle,
          alertMsg,
          'tournament_outranked',
          tournament.bannerUrl || null,
          prevUserId,
          false,
          scorerUserId,
          tournament.id
        ).catch(e => console.error('[TournamentService] Error sending outranked push notification:', e));
      }
    }
  }

}
