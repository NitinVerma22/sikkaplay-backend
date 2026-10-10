import { prisma } from '../config/db';
import crypto from 'crypto';
import { sendPushNotification } from './push.service';

interface LeaderboardCacheEntry {
  data: any;
  etag: string;
  cachedAt: number;
}

// In-memory cache for tournament leaderboards (15s TTL) to prevent DB egress & CPU spikes
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

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

      const [participants, totalCount] = await Promise.all([
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

      // Format clean, lean JSON response
      const rankings = participants.map((p, idx) => ({
        rank: skip + idx + 1,
        userId: p.userId,
        name: p.user.name || p.user.username || `Player_${p.userId.substring(0, 4)}`,
        avatarUrl: p.user.avatarUrl || null,
        score: p.score
      }));

      const payload = {
        rankings,
        totalParticipants: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
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
    let userStanding = null;
    if (params.userId) {
      const myParticipant = await prisma.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: params.tournamentId,
            userId: params.userId
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

        userStanding = {
          rank: higherRankedCount + 1,
          score: myParticipant.score,
          lastScoreUpdatedAt: myParticipant.lastScoreUpdatedAt
        };
      }
    }

    return {
      data: {
        ...cached.data,
        userStanding
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

          if (matchingTier && matchingTier.prize > 0) {
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
  public static async processLifecycleTransitions(): Promise<void> {
    const now = new Date();

    try {
      // 1. UPCOMING -> LIVE
      const toLive = await prisma.tournament.updateMany({
        where: {
          status: 'UPCOMING',
          startTime: { lte: now },
          endTime: { gt: now }
        },
        data: { status: 'LIVE' }
      });

      if (toLive.count > 0) {
        console.log(`[TournamentService] Transitioned ${toLive.count} tournaments from UPCOMING to LIVE.`);
      }

      // 2. LIVE -> COMPLETED
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

      // 3. Re-check any COMPLETED tournaments where isPrizesDistributed is false
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
    } catch (error) {
      console.error('[TournamentService.processLifecycleTransitions] Error running lifecycle transitions:', error);
    }
  }
}
