import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { TournamentService } from '../services/tournament.service';
import { invalidateConfigCache } from '../services/config.service';
import { DEFAULT_RECURRING_TEMPLATES, ensureRecurringDailyTournaments } from '../cron/tournament.cron';

export const parseThemeAndOrder = (tag?: string | null): { theme: string; order: number } => {
  if (!tag) return { theme: 'purple', order: 999 };
  const str = tag.trim();
  if (str.includes(':')) {
    const parts = str.split(':');
    const theme = parts[0].trim().toLowerCase() || 'purple';
    const order = parseInt(parts[1]) || 999;
    return { theme, order };
  }
  const knownThemes = ['purple', 'blue', 'green', 'amber', 'rose', 'cyan'];
  const matched = knownThemes.find(t => str.toLowerCase().includes(t));
  if (matched) {
    return { theme: matched, order: 999 };
  }
  return { theme: 'purple', order: 999 };
};

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
      select: { 
        isTournamentsEnabled: true,
        isRecurringTournamentsEnabled: true
      }
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

    const isRecurringEnabled = config?.isRecurringTournamentsEnabled ?? true;

    const now = new Date();
    let whereClause: any = {};

    // When automatic recurring tournaments is disabled, do not show recurring tournaments in any tab
    if (!isRecurringEnabled) {
      whereClause.isRecurring = false;
    }

    if (tab === 'live' || status === 'LIVE') {
      whereClause.status = 'LIVE';
    } else if (tab === 'upcoming' || status === 'UPCOMING') {
      whereClause.status = 'UPCOMING';
    } else if (tab === 'completed' || status === 'COMPLETED') {
      whereClause.status = 'COMPLETED';
    } else if (tab === 'history') {
      if (userId) {
        // User history: all tournaments user participated in (live or completed)
        whereClause.participants = {
          some: { userId }
        };
      } else {
        whereClause.status = { in: ['COMPLETED', 'CANCELLED'] };
      }
    } else if (tab === 'my' && userId) {
      // Current active tournaments user joined
      whereClause.status = 'LIVE';
      whereClause.participants = {
        some: { userId }
      };
    } else {
      // Default: Live + Upcoming
      whereClause.status = { in: ['LIVE', 'UPCOMING'] };
    }

    const isCompletedQuery = tab === 'completed' || status === 'COMPLETED';

    const tournaments = await prisma.tournament.findMany({
      where: whereClause,
      orderBy: isCompletedQuery
        ? [
            { endTime: 'desc' },
            { startTime: 'desc' }
          ]
        : [
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

    if (isCompletedQuery) {
      // Recent completed tournaments at top (descending by endTime)
      tournaments.sort((a, b) => {
        const timeB = new Date(b.endTime).getTime();
        const timeA = new Date(a.endTime).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      });
    } else if (tab === 'history') {
      tournaments.sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === 'LIVE') return -1;
          if (b.status === 'LIVE') return 1;
        }
        const timeB = new Date(b.endTime).getTime();
        const timeA = new Date(a.endTime).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      });
    } else {
      // Sort tournaments by admin arrangement order first (for live and upcoming)
      tournaments.sort((a, b) => {
        const orderA = parseThemeAndOrder(a.tag).order;
        const orderB = parseThemeAndOrder(b.tag).order;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
    }

    const formatted = tournaments.map((t) => {
      const userParticipant = (t as any).participants?.[0];
      const pCount = (t as any)._count?.participants || 0;
      const { theme, order } = parseThemeAndOrder(t.tag);
      const minPoints = (t as any).minPointsToWin ?? 1000;
      const tagBadge = minPoints > 0 ? `MIN ${minPoints} PTS` : (t.tag || 'MEGA');

      return {
        id: t.id,
        title: t.title,
        rawTitle: t.title,
        description: t.description,
        bannerUrl: t.bannerUrl,
        tag: tagBadge,
        gradientTheme: theme,
        order: order,
        displayOrder: order,
        entryType: t.entryType,
        entryFee: t.entryFee,
        entryFeeCoins: t.entryFee,
        prizePool: t.prizePool,
        prizePoolRupees: (t as any).prizePoolRupees || 0,
        prizeStructure: t.prizeStructure,
        minPointsToWin: minPoints,
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

    const config = await prisma.appConfig.findFirst({
      select: { isTournamentsEnabled: true, isRecurringTournamentsEnabled: true }
    });

    if (config && !config.isTournamentsEnabled) {
      res.status(403).json({ success: false, error: 'Tournaments are currently unavailable' });
      return;
    }

    if (tournament.isRecurring && config?.isRecurringTournamentsEnabled === false) {
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
    const minPoints = (tournament as any).minPointsToWin ?? 1000;
    const tagBadge = minPoints > 0 ? `MIN ${minPoints} PTS` : (tournament.tag || 'MEGA');

    res.status(200).json({
      success: true,
      tournament: {
        ...tournament,
        tag: tagBadge,
        title: tournament.title,
        rawTitle: tournament.title,
        minPointsToWin: minPoints,
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

    const config = await prisma.appConfig.findFirst({
      select: { isTournamentsEnabled: true, isRecurringTournamentsEnabled: true }
    });

    if (config && !config.isTournamentsEnabled) {
      res.status(403).json({ success: false, error: 'Tournaments are currently unavailable' });
      return;
    }

    if (tournament.isRecurring && config?.isRecurringTournamentsEnabled === false) {
      res.status(400).json({ success: false, error: 'Tournament is currently unavailable' });
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

    // Sort tournaments by admin arrangement order first
    tournaments.sort((a, b) => {
      const orderA = parseThemeAndOrder(a.tag).order;
      const orderB = parseThemeAndOrder(b.tag).order;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.status(200).json({
      success: true,
      tournaments: tournaments.map((t) => {
        const { theme, order } = parseThemeAndOrder(t.tag);
        return {
          ...t,
          order,
          displayOrder: order,
          gradientTheme: theme,
          participantCount: t._count.participants,
          winnersCount: t._count.prizesAwarded
        };
      })
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
      minPointsToWin,
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
        minPointsToWin: minPointsToWin !== undefined ? Math.max(0, parseInt(minPointsToWin) || 0) : 1000,
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
      minPointsToWin,
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
        ...(minPointsToWin !== undefined && { minPointsToWin: Math.max(0, parseInt(minPointsToWin) || 0) }),
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
        minPointsToWin: (original as any).minPointsToWin ?? 1000,
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

/**
 * GET /api/v1/tournaments/admin/recurring-settings
 * Admin: Get recurring tournament automation status and templates
 */
export const adminGetRecurringSettings = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.appConfig.findFirst({
      select: {
        isTournamentsEnabled: true,
        isRecurringTournamentsEnabled: true,
        recurringTournamentTemplates: true
      }
    });

    let templates = DEFAULT_RECURRING_TEMPLATES;
    if (config?.recurringTournamentTemplates && Array.isArray(config.recurringTournamentTemplates) && config.recurringTournamentTemplates.length > 0) {
      templates = config.recurringTournamentTemplates as any;
    }

    res.status(200).json({
      success: true,
      isTournamentsEnabled: config?.isTournamentsEnabled ?? false,
      isRecurringTournamentsEnabled: config?.isRecurringTournamentsEnabled ?? true,
      templates
    });
  } catch (error: any) {
    console.error('Error fetching recurring tournament settings:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch settings' });
  }
};

/**
 * POST /api/v1/tournaments/admin/recurring-settings
 * Admin: Update recurring tournament toggle and templates
 */
export const adminUpdateRecurringSettings = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { isRecurringTournamentsEnabled, templates } = req.body;
    const config = await prisma.appConfig.findFirst();

    if (!config) {
      res.status(404).json({ success: false, error: 'AppConfig not found' });
      return;
    }

    const dataToUpdate: any = {};
    if (typeof isRecurringTournamentsEnabled === 'boolean') {
      dataToUpdate.isRecurringTournamentsEnabled = isRecurringTournamentsEnabled;
    }
    if (Array.isArray(templates)) {
      dataToUpdate.recurringTournamentTemplates = templates;
    }

    const updated = await prisma.appConfig.update({
      where: { id: config.id },
      data: dataToUpdate,
      select: {
        isTournamentsEnabled: true,
        isRecurringTournamentsEnabled: true,
        recurringTournamentTemplates: true
      }
    });

    invalidateConfigCache();

    if (isRecurringTournamentsEnabled === false) {
      await prisma.tournament.updateMany({
        where: {
          isRecurring: true,
          status: 'UPCOMING',
          participants: { none: {} }
        },
        data: {
          status: 'CANCELLED'
        }
      });
    }

    let savedTemplates = DEFAULT_RECURRING_TEMPLATES;
    if (updated.recurringTournamentTemplates && Array.isArray(updated.recurringTournamentTemplates) && updated.recurringTournamentTemplates.length > 0) {
      savedTemplates = updated.recurringTournamentTemplates as any;
    }

    res.status(200).json({
      success: true,
      message: 'Recurring tournament settings saved successfully',
      isRecurringTournamentsEnabled: updated.isRecurringTournamentsEnabled,
      templates: savedTemplates
    });
  } catch (error: any) {
    console.error('Error updating recurring tournament settings:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update settings' });
  }
};

/**
 * POST /api/v1/tournaments/admin/trigger-recurring-creation
 * Admin: Manually trigger recurring tournament auto-creation on demand
 */
export const adminTriggerRecurringCreation = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    await ensureRecurringDailyTournaments();
    res.status(200).json({
      success: true,
      message: 'Recurring daily tournaments checked and created successfully'
    });
  } catch (error: any) {
    console.error('Error triggering recurring creation:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to trigger creation' });
  }
};

/**
 * POST /api/v1/tournaments/admin/reorder
 * Admin: Update arrangement order of tournaments
 */
export const adminReorderTournaments = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { tournamentIds } = req.body;
    if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
      res.status(400).json({ success: false, error: 'tournamentIds array is required' });
      return;
    }

    for (let i = 0; i < tournamentIds.length; i++) {
      const id = tournamentIds[i];
      const existing = await prisma.tournament.findUnique({
        where: { id },
        select: { id: true, tag: true }
      });
      if (existing) {
        const { theme } = parseThemeAndOrder(existing.tag);
        const newTag = `${theme}:${i + 1}`;
        await prisma.tournament.update({
          where: { id },
          data: { tag: newTag }
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Tournament arrangement updated successfully'
    });
  } catch (error: any) {
    console.error('Error reordering tournaments:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to reorder tournaments' });
  }
};

/**
 * DELETE /api/v1/tournaments/admin/:id
 * Admin: Permanently delete tournament and its participant records
 */
export const adminDeleteTournament = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tournament = await prisma.tournament.findUnique({
      where: { id }
    });

    if (!tournament) {
      res.status(404).json({ success: false, error: 'Tournament not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.tournamentPrizeWinner.deleteMany({
        where: { tournamentId: id }
      });

      await tx.tournamentParticipant.deleteMany({
        where: { tournamentId: id }
      });

      await tx.tournament.delete({
        where: { id }
      });
    });

    res.status(200).json({
      success: true,
      message: `Tournament "${tournament.title}" deleted successfully`
    });
  } catch (error: any) {
    console.error('Error deleting tournament:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete tournament' });
  }
};

/**
 * GET /api/v1/tournaments/admin/:id/details
 * Admin: View comprehensive tournament analytics, entry fees, liability & participant statuses
 */
export const adminGetTournamentDetails = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                email: true,
                balance: true
              }
            }
          },
          orderBy: [
            { score: 'desc' },
            { lastScoreUpdatedAt: 'asc' }
          ]
        },
        prizesAwarded: true
      }
    });

    if (!tournament) {
      res.status(404).json({ success: false, error: 'Tournament not found' });
      return;
    }

    const participants = tournament.participants || [];
    const totalParticipants = participants.length;
    const isPaid = tournament.entryType === 'COINS' && tournament.entryFee > 0;
    const entryFeePerUser = tournament.entryFee || 0;
    const totalFeesCollectedCoins = isPaid ? totalParticipants * entryFeePerUser : 0;

    const prizeLiabilityCoins = tournament.prizePool || 0;
    const prizeLiabilityRupees = tournament.prizePoolRupees || 0;
    const netCoinMargin = totalFeesCollectedCoins - prizeLiabilityCoins;

    const winnersMap = new Map<string, number>();
    for (const w of tournament.prizesAwarded || []) {
      winnersMap.set(w.userId, w.prizeCoins);
    }

    const prizeTiers = Array.isArray(tournament.prizeStructure) ? (tournament.prizeStructure as any[]) : [];
    const detailedParticipants = participants.map((p, idx) => {
      const rank = idx + 1;
      const awardedCoins = winnersMap.get(p.userId);

      let eligibleCoins = 0;
      let eligibleRupees = 0;
      if (tournament.isPrizesDistributed && awardedCoins !== undefined) {
        eligibleCoins = awardedCoins;
      } else {
        const tier = prizeTiers.find(t => rank >= t.rankMin && rank <= t.rankMax);
        if (tier) {
          eligibleCoins = tier.prize || 0;
          eligibleRupees = tier.prizeRupees || 0;
        }
      }

      return {
        userId: p.userId,
        name: p.user?.name || 'Player',
        phone: p.user?.phoneNumber || null,
        email: p.user?.email || null,
        joinedAt: p.joinedAt,
        score: p.score,
        lastScoreUpdatedAt: p.lastScoreUpdatedAt,
        rank,
        awardedCoins: awardedCoins ?? null,
        eligibleCoins,
        eligibleRupees,
        isPrizeDistributed: awardedCoins !== undefined,
        status: tournament.isPrizesDistributed
          ? (awardedCoins !== undefined && awardedCoins > 0 ? 'Prize Distributed' : 'Completed')
          : (eligibleCoins > 0 ? `In Prize Zone (Rank #${rank})` : 'Active')
      };
    });

    res.status(200).json({
      success: true,
      details: {
        id: tournament.id,
        title: tournament.title,
        description: tournament.description,
        status: tournament.status,
        entryType: tournament.entryType,
        entryFee: tournament.entryFee,
        startTime: tournament.startTime,
        endTime: tournament.endTime,
        prizePool: tournament.prizePool,
        prizePoolRupees: tournament.prizePoolRupees || 0,
        isPrizesDistributed: tournament.isPrizesDistributed,
        allowedGames: tournament.allowedGames,
        maxParticipants: tournament.maxParticipants,
        summary: {
          totalParticipants,
          entryFeesCollectedCoins: totalFeesCollectedCoins,
          prizeLiabilityCoins,
          prizeLiabilityRupees,
          netCoinMargin,
          distributionStatus: tournament.isPrizesDistributed ? 'COMPLETED' : 'PENDING'
        },
        participants: detailedParticipants
      }
    });
  } catch (error: any) {
    console.error('Error fetching tournament details:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch tournament details' });
  }
};

/**
 * POST /api/v1/tournaments/admin/:tournamentId/participants/:userId/score
 * Admin: Modify or increase a participant's score/points
 */
export const adminUpdateParticipantScore = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const tournamentId = String(req.params.tournamentId);
    const userId = String(req.params.userId);
    const { score, mode } = req.body;

    const parsedScore = parseInt(score);
    if (isNaN(parsedScore)) {
      res.status(400).json({ success: false, error: 'Valid score number is required' });
      return;
    }

    const participant = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: { tournamentId, userId }
      }
    });

    if (!participant) {
      res.status(404).json({ success: false, error: 'Participant not found in this tournament' });
      return;
    }

    const finalScore = mode === 'add' ? Math.max(0, participant.score + parsedScore) : Math.max(0, parsedScore);

    const updated = await prisma.tournamentParticipant.update({
      where: {
        tournamentId_userId: { tournamentId, userId }
      },
      data: {
        score: finalScore,
        lastScoreUpdatedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phoneNumber: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: `Score updated to ${finalScore} points successfully`,
      participant: {
        userId: updated.userId,
        name: updated.user?.name || 'Player',
        phone: updated.user?.phoneNumber || null,
        score: updated.score
      }
    });
  } catch (error: any) {
    console.error('Error updating participant score:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update score' });
  }
};
