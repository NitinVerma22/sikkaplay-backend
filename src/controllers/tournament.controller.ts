import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { TournamentService } from '../services/tournament.service';
import { invalidateConfigCache } from '../services/config.service';

/**
 * GET /api/v1/tournaments
 * Lists tournaments filtered by tab: 'live' | 'upcoming' | 'completed' | 'history' | 'my'
 */
export const getTournaments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { tab, status } = req.query;

    // Feature flag check: If tournaments disabled and requester is not admin, hide them
    const config = await prisma.appConfig.findFirst({
      select: { isTournamentsEnabled: true }
    });

    if (config && !config.isTournamentsEnabled) {
      // Return empty array gracefully during hidden/pre-launch state
      res.status(200).json({
        success: true,
        isEnabled: false,
        tournaments: []
      });
      return;
    }

    const now = new Date();
    let whereClause: any = {};

    if (tab === 'live' || status === 'LIVE') {
      whereClause = {
        status: 'LIVE'
      };
    } else if (tab === 'upcoming' || status === 'UPCOMING') {
      whereClause = {
        status: 'UPCOMING'
      };
    } else if (tab === 'completed' || status === 'COMPLETED') {
      whereClause = {
        status: 'COMPLETED'
      };
    } else if (tab === 'history') {
      if (userId) {
        // User history: all tournaments user participated in (live or completed)
        whereClause = {
          participants: {
            some: { userId }
          }
        };
      } else {
        whereClause = {
          status: { in: ['COMPLETED', 'CANCELLED'] }
        };
      }
    } else if (tab === 'my' && userId) {
      // Current active tournaments user joined
      whereClause = {
        status: 'LIVE',
        participants: {
          some: { userId }
        }
      };
    } else {
      // Default: Live + Upcoming
      whereClause = {
        status: { in: ['LIVE', 'UPCOMING'] }
      };
    }

    const tournaments = await prisma.tournament.findMany({
      where: whereClause,
      orderBy: [
        { status: 'asc' }, // LIVE before UPCOMING
        { startTime: 'asc' }
      ],
      include: {
        _count: {
          select: { participants: true }
        },
        participants: userId ? {
          where: { userId },
          select: { id: true, score: true, joinedAt: true }
        } : false
      }
    });

    const formatted = tournaments.map((t) => {
      const userParticipant = (t as any).participants?.[0];
      const pCount = (t as any)._count?.participants || 0;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        bannerUrl: t.bannerUrl,
        tag: t.tag,
        entryType: t.entryType,
        entryFee: t.entryFee,
        entryFeeCoins: t.entryFee,
        prizePool: t.prizePool,
        prizePoolRupees: (t as any).prizePoolRupees || 0,
        prizeStructure: t.prizeStructure,
        maxParticipants: t.maxParticipants,
        allowedGames: t.allowedGames,
        scoreMultiplier: t.scoreMultiplier,
        startTime: t.startTime,
        endTime: t.endTime,
        status: t.status,
        isPrizesDistributed: t.isPrizesDistributed,
        participantCount: pCount,
        currentParticipants: pCount,
        isJoined: !!userParticipant,
        myScore: userParticipant?.score || 0,
        userParticipation: userParticipant ? {
          id: userParticipant.id || t.id,
          score: userParticipant.score || 0,
          joinedAt: userParticipant.joinedAt || new Date()
        } : null
      };
    });

    res.status(200).json({
      success: true,
      isEnabled: true,
      tournaments: formatted
    });
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tournaments' });
  }
};

/**
 * GET /api/v1/tournaments/:id
 * Fetches tournament detail, user progress, rules, and podium preview
 */
export const getTournamentDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const id = String(req.params.id);

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        _count: {
          select: { participants: true }
        }
      }
    });

    if (!tournament) {
      res.status(404).json({ success: false, error: 'Tournament not found' });
      return;
    }

    // Get user's enrollment and standing if logged in
    let userStanding = null;
    if (userId) {
      const participant = await prisma.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: id,
            userId
          }
        }
      });

      if (participant) {
        const higherCount = await prisma.tournamentParticipant.count({
          where: {
            tournamentId: id,
            OR: [
              { score: { gt: participant.score } },
              {
                score: participant.score,
                lastScoreUpdatedAt: { lt: participant.lastScoreUpdatedAt }
              }
            ]
          }
        });

        userStanding = {
          isJoined: true,
          score: participant.score,
          rank: higherCount + 1,
          joinedAt: participant.joinedAt
        };
      }
    }

    // Fetch Top 3 podium preview
    const topThree = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: id },
      orderBy: [
        { score: 'desc' },
        { lastScoreUpdatedAt: 'asc' }
      ],
      take: 3,
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

    const pCount = (tournament as any)._count?.participants || 0;
    res.status(200).json({
      success: true,
      tournament: {
        ...tournament,
        entryFeeCoins: tournament.entryFee,
        participantCount: pCount,
        currentParticipants: pCount,
        isJoined: !!userStanding?.isJoined,
        userParticipation: userStanding ? {
          id: tournament.id,
          score: userStanding.score || 0,
          rank: userStanding.rank,
          joinedAt: userStanding.joinedAt || new Date()
        } : null,
        userStanding: userStanding || { isJoined: false, score: 0, rank: null },
        podium: (topThree as any[]).map((p, idx) => ({
          rank: idx + 1,
          userId: p.userId,
          name: p.user?.name || p.user?.username || 'Player',
          avatarUrl: p.user?.avatarUrl || null,
          score: p.score
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching tournament details:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tournament details' });
  }
};

/**
 * POST /api/v1/tournaments/:id/join
 * Join tournament via Rewarded Ad (FREE) or Coins Deduction (COINS)
 */
export const joinTournament = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        _count: { select: { participants: true } }
      }
    });

    if (!tournament) {
      res.status(404).json({ success: false, error: 'Tournament not found' });
      return;
    }

    if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
      res.status(400).json({ success: false, error: 'Tournament is no longer active' });
      return;
    }

    if (new Date() > tournament.endTime) {
      res.status(400).json({ success: false, error: 'Tournament has already ended' });
      return;
    }

    const participantCount = (tournament as any)._count?.participants || 0;
    if (tournament.maxParticipants && participantCount >= tournament.maxParticipants) {
      res.status(400).json({ success: false, error: 'Tournament participant limit reached' });
      return;
    }

    // Check if already joined
    const existing = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId: id,
          userId
        }
      }
    });

    if (existing) {
      res.status(200).json({
        success: true,
        message: 'Already joined',
        isJoined: true,
        participant: {
          id: existing.id,
          score: existing.score,
          joinedAt: existing.joinedAt
        }
      });
      return;
    }

    // Process Entry Fee
    if (tournament.entryType === 'COINS' && tournament.entryFee > 0) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      });

      if (!user || user.balance < tournament.entryFee) {
        res.status(400).json({
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient coins. You need ${tournament.entryFee} coins to join.`
        });
        return;
      }

      // Deduct coins & enroll inside transaction
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { decrement: tournament.entryFee }
          }
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: -tournament.entryFee,
            type: 'tournament_entry',
            status: 'success',
            description: `Entry fee for tournament: ${tournament.title}`
          }
        });

        await tx.tournamentParticipant.create({
          data: {
            tournamentId: id,
            userId,
            score: 0
          }
        });
      });
    } else {
      // Free Entry (Rewarded Ad)
      await prisma.tournamentParticipant.create({
        data: {
          tournamentId: id,
          userId,
          score: 0
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Successfully joined tournament',
      isJoined: true,
      participant: {
        id: id,
        score: 0,
        joinedAt: new Date()
      }
    });
  } catch (error: any) {
    console.error('Error joining tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to join tournament' });
  }
};

/**
 * GET /api/v1/tournaments/:id/leaderboard
 * Fetches paginated leaderboard with in-memory caching and ETag support
 */
export const getLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const id = String(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const ifNoneMatch = req.headers['if-none-match'];

    const result = await TournamentService.getLeaderboard({
      tournamentId: id,
      userId,
      page,
      limit,
      ifNoneMatch
    });

    if (result.isNotModified) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', result.etag);
    res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
};

// ==================== ADMIN ENDPOINTS ====================

/**
 * GET /api/v1/admin/tournaments
 * Admin: List all tournaments with full details
 */
export const adminListTournaments = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { participants: true, prizesAwarded: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      tournaments: tournaments.map((t) => ({
        ...t,
        participantCount: t._count.participants,
        winnersCount: t._count.prizesAwarded
      }))
    });
  } catch (error) {
    console.error('Error in adminListTournaments:', error);
    res.status(500).json({ success: false, error: 'Failed to list tournaments' });
  }
};

/**
 * POST /api/v1/admin/tournaments
 * Admin: Create a new tournament
 */
export const adminCreateTournament = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      bannerUrl,
      tag,
      entryType,
      entryFee,
      maxParticipants,
      allowedGames,
      scoreMultiplier,
      prizePool,
      prizePoolRupees,
      prizeStructure,
      startTime,
      endTime,
      isRecurring,
      recurringCron,
      status
    } = req.body;

    if (!title || !startTime || !endTime) {
      res.status(400).json({ success: false, error: 'Title, startTime, and endTime are required' });
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      res.status(400).json({ success: false, error: 'endTime must be greater than startTime' });
      return;
    }

    const now = new Date();
    let initialStatus: 'UPCOMING' | 'LIVE' = 'UPCOMING';
    if (status === 'LIVE' || status === 'UPCOMING') {
      initialStatus = status;
    } else if (now >= start && now < end) {
      initialStatus = 'LIVE';
    }

    const tournament = await prisma.tournament.create({
      data: {
        title,
        description: description || null,
        bannerUrl: bannerUrl || null,
        tag: tag || null,
        entryType: entryType === 'COINS' ? 'COINS' : 'FREE',
        entryFee: entryType === 'COINS' ? Math.max(0, parseInt(entryFee) || 0) : 0,
        maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
        allowedGames: Array.isArray(allowedGames) && allowedGames.length > 0 ? allowedGames : [
          'treasure_grid', 'emoji_memory', 'math_rush', 'water_sort', 'bubble_shooter', 'arrow_escape'
        ],
        scoreMultiplier: scoreMultiplier ? parseFloat(scoreMultiplier) : 1.0,
        prizePool: parseInt(prizePool) || 0,
        prizePoolRupees: parseInt(prizePoolRupees) || 0,
        prizeStructure: Array.isArray(prizeStructure) ? prizeStructure : [],
        startTime: start,
        endTime: end,
        status: initialStatus,
        isRecurring: !!isRecurring,
        recurringCron: recurringCron || null
      }
    });

    res.status(201).json({
      success: true,
      tournament
    });
  } catch (error: any) {
    console.error('Error creating tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create tournament' });
  }
};

/**
 * PUT /api/v1/admin/tournaments/:id
 * Admin: Update tournament configuration
 */
export const adminUpdateTournament = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const {
      title,
      description,
      bannerUrl,
      tag,
      entryType,
      entryFee,
      maxParticipants,
      allowedGames,
      scoreMultiplier,
      prizePool,
      prizePoolRupees,
      prizeStructure,
      startTime,
      endTime,
      status
    } = req.body;

    const tournament = await prisma.tournament.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(bannerUrl !== undefined && { bannerUrl }),
        ...(tag !== undefined && { tag }),
        ...(entryType !== undefined && { entryType: entryType === 'COINS' ? 'COINS' : 'FREE' }),
        ...(entryFee !== undefined && { entryFee: Math.max(0, parseInt(entryFee) || 0) }),
        ...(maxParticipants !== undefined && { maxParticipants: maxParticipants ? parseInt(maxParticipants) : null }),
        ...(allowedGames !== undefined && { allowedGames }),
        ...(scoreMultiplier !== undefined && { scoreMultiplier: parseFloat(scoreMultiplier) }),
        ...(prizePool !== undefined && { prizePool: parseInt(prizePool) || 0 }),
        ...(prizePoolRupees !== undefined && { prizePoolRupees: parseInt(prizePoolRupees) || 0 }),
        ...(prizeStructure !== undefined && { prizeStructure }),
        ...(startTime && { startTime: new Date(startTime) }),
        ...(endTime && { endTime: new Date(endTime) }),
        ...(status && { status })
      }
    });

    res.status(200).json({ success: true, tournament });
  } catch (error: any) {
    console.error('Error updating tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update tournament' });
  }
};

/**
 * POST /api/v1/admin/tournaments/:id/duplicate
 * Admin: Duplicate tournament configuration
 */
export const adminDuplicateTournament = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const original = await prisma.tournament.findUnique({ where: { id } });

    if (!original) {
      res.status(404).json({ success: false, error: 'Original tournament not found' });
      return;
    }

    const newStart = new Date(Date.now() + 60 * 60 * 1000); // 1 hour in future
    const durationMs = original.endTime.getTime() - original.startTime.getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);

    const clone = await prisma.tournament.create({
      data: {
        title: `${original.title} (Copy)`,
        description: original.description,
        bannerUrl: original.bannerUrl,
        tag: original.tag,
        entryType: original.entryType,
        entryFee: original.entryFee,
        maxParticipants: original.maxParticipants,
        allowedGames: original.allowedGames,
        scoreMultiplier: original.scoreMultiplier,
        prizePool: original.prizePool,
        prizePoolRupees: original.prizePoolRupees || 0,
        prizeStructure: original.prizeStructure as any,
        startTime: newStart,
        endTime: newEnd,
        status: 'UPCOMING',
        isPrizesDistributed: false
      }
    });

    res.status(201).json({ success: true, tournament: clone });
  } catch (error: any) {
    console.error('Error duplicating tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to duplicate tournament' });
  }
};

/**
 * POST /api/v1/admin/tournaments/:id/cancel
 * Admin: Cancel tournament & refund all entry fees to participants
 */
export const adminCancelTournament = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: { participants: true }
    });

    if (!tournament) {
      res.status(404).json({ success: false, error: 'Tournament not found' });
      return;
    }

    const participants = (tournament as any).participants || [];

    await prisma.$transaction(async (tx) => {
      // 1. Mark status CANCELLED
      await tx.tournament.update({
        where: { id },
        data: { status: 'CANCELLED' }
      });

      // 2. Refund coins if paid entry
      if (tournament.entryType === 'COINS' && tournament.entryFee > 0) {
        for (const p of participants) {
          await tx.user.update({
            where: { id: p.userId },
            data: { balance: { increment: tournament.entryFee } }
          });

          await tx.transaction.create({
            data: {
              userId: p.userId,
              amount: tournament.entryFee,
              type: 'tournament_refund',
              status: 'success',
              description: `Refund for cancelled tournament: ${tournament.title}`
            }
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message: `Tournament cancelled. Refunded ${participants.length} participants.`
    });
  } catch (error: any) {
    console.error('Error cancelling tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to cancel tournament' });
  }
};

/**
 * POST /api/v1/admin/tournaments/:id/payout
 * Admin: Manually trigger prize distribution
 */
export const adminTriggerPayout = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const success = await TournamentService.distributePrizesForTournament(id);

    if (success) {
      res.status(200).json({ success: true, message: 'Prizes distributed successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Could not distribute prizes (already distributed or empty pool)' });
    }
  } catch (error: any) {
    console.error('Error triggering payout:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to trigger payout' });
  }
};

/**
 * POST /api/v1/admin/tournaments/toggle-feature-flag
 * Admin: Turn master feature flag ON or OFF
 */
export const adminToggleFeatureFlag = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { isEnabled } = req.body;
    const config = await prisma.appConfig.findFirst();

    if (!config) {
      res.status(404).json({ success: false, error: 'AppConfig not found' });
      return;
    }

    const updated = await prisma.appConfig.update({
      where: { id: config.id },
      data: { isTournamentsEnabled: !!isEnabled }
    });

    invalidateConfigCache();

    res.status(200).json({
      success: true,
      isTournamentsEnabled: updated.isTournamentsEnabled
    });
  } catch (error: any) {
    console.error('Error toggling feature flag:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to toggle feature flag' });
  }
};
