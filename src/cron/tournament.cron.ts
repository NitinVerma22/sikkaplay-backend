import cron from 'node-cron';
import { prisma } from '../config/db';
import { TournamentService } from '../services/tournament.service';

/**
 * Ensures today's recurring scheduled flash tournaments and daily cup exist in DB.
 * Default recurring templates:
 *  - 1-Hour Flash Morning: 09:00 - 10:00 IST
 *  - 1-Hour Flash Evening: 18:00 - 19:00 IST
 *  - 1-Hour Flash Night: 22:00 - 23:00 IST
 *  - Daily Mega Cup: 00:00 - 23:59 IST
 */
export const ensureRecurringDailyTournaments = async (): Promise<void> => {
  try {
    const config = await prisma.appConfig.findFirst({
      select: { isTournamentsEnabled: true }
    });

    // Don't auto-create if tournaments master switch is off
    if (config && !config.isTournamentsEnabled) {
      return;
    }

    // Get today's IST midnight in UTC
    const now = new Date();
    // IST is UTC + 5:30 (330 minutes)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(now.getTime() + istOffsetMs);
    const year = nowIst.getUTCFullYear();
    const month = nowIst.getUTCMonth();
    const day = nowIst.getUTCDate();

    // Helper to create UTC Date from IST hours & minutes
    const createIstDateInUtc = (hours: number, minutes: number): Date => {
      // Midnight IST in UTC is Date.UTC(year, month, day, 0, 0) - istOffsetMs
      const istMidnightUtc = Date.UTC(year, month, day, 0, 0, 0) - istOffsetMs;
      return new Date(istMidnightUtc + (hours * 60 + minutes) * 60 * 1000);
    };

    const templates = [
      {
        title: '1-Hour Flash Rush (Morning)',
        tag: 'FLASH ⚡',
        startHour: 9,
        startMin: 0,
        endHour: 10,
        endMin: 0,
        entryType: 'FREE' as const,
        entryFee: 0,
        prizePool: 1500,
        prizeStructure: [
          { rankMin: 1, rankMax: 1, prize: 500 },
          { rankMin: 2, rankMax: 2, prize: 300 },
          { rankMin: 3, rankMax: 3, prize: 200 },
          { rankMin: 4, rankMax: 10, prize: 50 },
          { rankMin: 11, rankMax: 20, prize: 15 }
        ]
      },
      {
        title: '1-Hour Flash Rush (Evening)',
        tag: 'FLASH ⚡',
        startHour: 18,
        startMin: 0,
        endHour: 19,
        endMin: 0,
        entryType: 'FREE' as const,
        entryFee: 0,
        prizePool: 2500,
        prizeStructure: [
          { rankMin: 1, rankMax: 1, prize: 1000 },
          { rankMin: 2, rankMax: 2, prize: 500 },
          { rankMin: 3, rankMax: 3, prize: 250 },
          { rankMin: 4, rankMax: 10, prize: 75 },
          { rankMin: 11, rankMax: 25, prize: 15 }
        ]
      },
      {
        title: '1-Hour Flash Rush (Night Peak)',
        tag: 'HOT 🔥',
        startHour: 22,
        startMin: 0,
        endHour: 23,
        endMin: 0,
        entryType: 'FREE' as const,
        entryFee: 0,
        prizePool: 3000,
        prizeStructure: [
          { rankMin: 1, rankMax: 1, prize: 1200 },
          { rankMin: 2, rankMax: 2, prize: 600 },
          { rankMin: 3, rankMax: 3, prize: 300 },
          { rankMin: 4, rankMax: 10, prize: 100 },
          { rankMin: 11, rankMax: 30, prize: 10 }
        ]
      },
      {
        title: 'Daily Mega Cup',
        tag: 'MEGA 🏆',
        startHour: 0,
        startMin: 0,
        endHour: 23,
        endMin: 59,
        entryType: 'COINS' as const,
        entryFee: 50,
        prizePool: 10000,
        prizeStructure: [
          { rankMin: 1, rankMax: 1, prize: 3500 },
          { rankMin: 2, rankMax: 2, prize: 2000 },
          { rankMin: 3, rankMax: 3, prize: 1000 },
          { rankMin: 4, rankMax: 10, prize: 300 },
          { rankMin: 11, rankMax: 50, prize: 35 }
        ]
      }
    ];

    for (const tpl of templates) {
      const startTime = createIstDateInUtc(tpl.startHour, tpl.startMin);
      const endTime = createIstDateInUtc(tpl.endHour, tpl.endMin);

      // Check if this tournament already exists for today's time range
      const existing = await prisma.tournament.findFirst({
        where: {
          title: tpl.title,
          startTime: {
            gte: new Date(startTime.getTime() - 5 * 60 * 1000),
            lte: new Date(startTime.getTime() + 5 * 60 * 1000)
          }
        }
      });

      if (!existing) {
        let status: 'UPCOMING' | 'LIVE' | 'COMPLETED' = 'UPCOMING';
        if (now >= startTime && now < endTime) {
          status = 'LIVE';
        } else if (now >= endTime) {
          status = 'COMPLETED';
        }

        await prisma.tournament.create({
          data: {
            title: tpl.title,
            tag: tpl.tag,
            entryType: tpl.entryType,
            entryFee: tpl.entryFee,
            prizePool: tpl.prizePool,
            prizeStructure: tpl.prizeStructure,
            startTime,
            endTime,
            status,
            isRecurring: true,
            allowedGames: [
              'treasure_grid', 'emoji_memory', 'math_rush', 'water_sort', 'bubble_shooter', 'arrow_escape'
            ]
          }
        });
        console.log(`[TournamentCron] Auto-scheduled recurring tournament: "${tpl.title}" for ${startTime.toISOString()}`);
      }
    }
  } catch (error) {
    console.error('[TournamentCron.ensureRecurringDailyTournaments] Error auto-scheduling tournaments:', error);
  }
};

/**
 * Initializes all tournament background cron jobs
 */
export const initTournamentCron = (): void => {
  console.log('[TournamentCron] Initializing Tournament Cron Engine...');

  // 1. Run lifecycle transition & auto-payout check every 1 minute
  cron.schedule('* * * * *', async () => {
    try {
      await TournamentService.processLifecycleTransitions();
    } catch (err) {
      console.error('[TournamentCron] Error in 1-minute lifecycle cron:', err);
    }
  });

  // 2. Run recurring daily schedule generator every night at 00:05 IST (18:35 UTC) and once at startup
  cron.schedule('35 18 * * *', async () => {
    try {
      await ensureRecurringDailyTournaments();
    } catch (err) {
      console.error('[TournamentCron] Error in daily recurring tournaments cron:', err);
    }
  });

  // Run initial checks on server startup
  TournamentService.processLifecycleTransitions().catch((err) =>
    console.error('[TournamentCron] Startup transition check error:', err)
  );
  ensureRecurringDailyTournaments().catch((err) =>
    console.error('[TournamentCron] Startup recurring tournaments check error:', err)
  );

  console.log('[TournamentCron] Tournament Cron Engine started successfully.');
};
