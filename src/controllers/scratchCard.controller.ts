import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';

const DEFAULT_REWARDS = [100, 150, 200, 250, 150, 300, 150, 400, 250, 350, 200, 500];
const VALID_REWARDED_NETWORKS = new Set(['admob', 'off']);
const VALID_NATIVE_NETWORKS = new Set(['admob', 'off']);

const getIstDateStr = (): string => {
  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istTime.toISOString().split('T')[0];
};

const normalizeCardRewards = (
  rawRewards: unknown,
  totalCards: number,
  minCoins: number,
  maxCoins: number
): number[] => {
  const parsed: number[] = Array.isArray(rawRewards)
    ? rawRewards
        .map((v) => Math.floor(Number(v)))
        .filter((v) => Number.isFinite(v) && v > 0)
    : [];

  const result: number[] = [];
  const safeMin = Math.max(1, Math.floor(minCoins));
  const safeMax = Math.max(safeMin, Math.floor(maxCoins));

  for (let i = 0; i < totalCards; i++) {
    if (i < parsed.length) {
      result.push(parsed[i]);
    } else {
      const span = safeMax - safeMin;
      const ratio = totalCards > 1 ? (i % 5) / 4 : 0.5;
      const value = Math.round((safeMin + span * ratio) / 10) * 10;
      result.push(Math.max(safeMin, Math.min(safeMax, value || safeMin)));
    }
  }
  return result;
};

export const getOrCreateScratchConfig = async () => {
  let config = await prisma.scratchCardConfig.findUnique({
    where: { id: 'default' },
  });

  if (!config) {
    config = await prisma.scratchCardConfig.create({
      data: {
        id: 'default',
        isEnabled: true,
        homeTitle: 'Scratch & Win',
        homeSubtitle: 'Reward from 50-500 Coins per scratch',
        heading: 'Scratch All Cards & Win Upto 3000 Coins',
        popupButtonText: 'Watch Video to Claim',
        totalCards: DEFAULT_REWARDS.length,
        minCoins: 50,
        maxCoins: 500,
        bannerMaxCoins: 3000,
        cardRewards: DEFAULT_REWARDS,
        rewardedAdNetwork: 'admob',
        nativeAdNetwork: 'admob',
        nativeAdEveryNCards: 4,
        scratchThresholdPercent: 70,
        liftoffRewardedId: '',
        liftoffNativeId: '',
        yandexAppId: '',
        yandexRewardedId: '',
        admobRewardedId: '',
        admobNativeId: '',
      },
    });
  }

  return config;
};

const formatPublicConfig = (config: any) => ({
  isEnabled: config.isEnabled,
  homeTitle: config.homeTitle || 'Scratch & Win',
  homeSubtitle: config.homeSubtitle || `Reward from ${config.minCoins}-${config.maxCoins} Coins per scratch`,
  heading: config.heading || 'Scratch All Cards & Win Upto 3000 Coins',
  popupButtonText: config.popupButtonText || 'Watch Video to Claim',
  totalCards: config.totalCards,
  minCoins: config.minCoins,
  maxCoins: config.maxCoins,
  bannerMaxCoins: config.bannerMaxCoins,
  rewardedAdNetwork: VALID_REWARDED_NETWORKS.has(config.rewardedAdNetwork)
    ? config.rewardedAdNetwork
    : 'admob',
  nativeAdNetwork: VALID_NATIVE_NETWORKS.has(config.nativeAdNetwork)
    ? config.nativeAdNetwork
    : 'admob',
  nativeAdEveryNCards: Math.max(1, Math.min(20, Number(config.nativeAdEveryNCards) || 4)),
  scratchThresholdPercent: Math.max(10, Math.min(95, Number(config.scratchThresholdPercent) || 70)),
  admobRewardedId: config.admobRewardedId || '',
  admobNativeId: config.admobNativeId || '',
});

// ==========================================
// USER CONTROLLERS
// ==========================================

/**
 * GET /api/user/scratch-cards
 * Returns full live Scratch & Win config + today's cards and claim state for the user.
 */
export const getUserScratchCards = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    const config = await getOrCreateScratchConfig();
    const dateStr = getIstDateStr();

    const cardRewards = normalizeCardRewards(
      config.cardRewards,
      config.totalCards,
      config.minCoins,
      config.maxCoins
    );

    const todayClaims = await prisma.scratchCardClaim.findMany({
      where: { userId, dateStr },
    });

    const claimMap = new Map(todayClaims.map((c) => [c.cardIndex, c]));

    const cards = cardRewards.map((coins, index) => {
      const claim = claimMap.get(index);
      return {
        index,
        coins: claim ? claim.coinsEarned : coins,
        isClaimed: Boolean(claim),
        claimedAt: claim ? claim.claimedAt : null,
      };
    });

    const totalClaimedCoinsToday = todayClaims.reduce((sum, c) => sum + c.coinsEarned, 0);

    res.status(200).json({
      success: true,
      dateStr,
      config: formatPublicConfig(config),
      claimedCount: todayClaims.length,
      totalClaimedCoinsToday,
      cards,
    });
  } catch (error) {
    console.error('Error fetching scratch cards:', error);
    res.status(500).json({ error: 'Internal server error while fetching scratch cards' });
  }
};

/**
 * POST /api/user/scratch-cards/claim
 * Credits the coin reward for a specific card index after the user watches the rewarded video ad.
 */
export const claimScratchCard = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const rawCardIndex = req.body?.cardIndex;
    const cardIndex = typeof rawCardIndex === 'number' ? Math.floor(rawCardIndex) : parseInt(rawCardIndex, 10);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    if (!Number.isInteger(cardIndex) || cardIndex < 0) {
      res.status(400).json({ error: 'Valid cardIndex is required' });
      return;
    }

    const config = await getOrCreateScratchConfig();
    if (!config.isEnabled) {
      res.status(400).json({ error: 'Scratch & Win offer is currently paused by admin.' });
      return;
    }

    if (cardIndex >= config.totalCards) {
      res.status(400).json({ error: 'Invalid scratch card index.' });
      return;
    }

    const dateStr = getIstDateStr();

    const existingClaim = await prisma.scratchCardClaim.findUnique({
      where: {
        userId_dateStr_cardIndex: {
          userId,
          dateStr,
          cardIndex,
        },
      },
    });

    if (existingClaim) {
      res.status(400).json({ error: 'You have already claimed this scratch card today.' });
      return;
    }

    const cardRewards = normalizeCardRewards(
      config.cardRewards,
      config.totalCards,
      config.minCoins,
      config.maxCoins
    );
    const coinsEarned = cardRewards[cardIndex];

    const result = await prisma.$transaction(async (tx) => {
      const claimRecord = await tx.scratchCardClaim.create({
        data: {
          userId,
          cardIndex,
          coinsEarned,
          dateStr,
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsEarned },
          totalEarned: { increment: coinsEarned },
        },
      });

      const transactionRecord = await tx.transaction.create({
        data: {
          userId,
          amount: coinsEarned,
          type: 'earning',
          status: 'success',
          description: `Scratch & Win Reward (Card #${cardIndex + 1})`,
        },
      });

      return { claim: claimRecord, user: updatedUser, transaction: transactionRecord };
    });

    res.status(200).json({
      success: true,
      message: `Congratulations! +${coinsEarned} Coins added to your wallet!`,
      cardIndex,
      coinsEarned,
      newBalance: result.user.balance,
      transaction: result.transaction,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(400).json({ error: 'You have already claimed this scratch card today.' });
      return;
    }
    console.error('Error claiming scratch card:', error);
    res.status(500).json({ error: 'Internal server error while claiming scratch card' });
  }
};

// ==========================================
// ADMIN CONTROLLERS
// ==========================================

/**
 * GET /api/admin/scratch-cards/config
 * Returns full Scratch & Win settings + live claim analytics.
 */
export const getAdminScratchConfig = async (_req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const config = await getOrCreateScratchConfig();
    const dateStr = getIstDateStr();

    const normalizedRewards = normalizeCardRewards(
      config.cardRewards,
      config.totalCards,
      config.minCoins,
      config.maxCoins
    );

    const [todayAgg, totalAgg, todayUniqueUsers] = await Promise.all([
      prisma.scratchCardClaim.aggregate({
        where: { dateStr },
        _count: true,
        _sum: { coinsEarned: true },
      }),
      prisma.scratchCardClaim.aggregate({
        _count: true,
        _sum: { coinsEarned: true },
      }),
      prisma.scratchCardClaim.groupBy({
        by: ['userId'],
        where: { dateStr },
      }),
    ]);

    res.status(200).json({
      success: true,
      config: {
        ...config,
        ...formatPublicConfig(config),
        cardRewards: normalizedRewards,
      },
      stats: {
        dateStr,
        todayClaims: todayAgg._count || 0,
        todayCoins: todayAgg._sum.coinsEarned || 0,
        uniqueUsersToday: todayUniqueUsers.length,
        totalClaims: totalAgg._count || 0,
        totalCoins: totalAgg._sum.coinsEarned || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching admin scratch card config:', error);
    res.status(500).json({ error: 'Internal server error while fetching scratch card config' });
  }
};

/**
 * PUT /api/admin/scratch-cards/config
 * Updates ALL Scratch & Win settings (card count, coins, ad networks, frequency, scratch %, texts, IDs).
 */
export const updateAdminScratchConfig = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const {
      isEnabled,
      homeTitle,
      homeSubtitle,
      heading,
      popupButtonText,
      totalCards,
      minCoins,
      maxCoins,
      bannerMaxCoins,
      cardRewards,
      rewardedAdNetwork,
      nativeAdNetwork,
      nativeAdEveryNCards,
      scratchThresholdPercent,
      liftoffRewardedId,
      liftoffNativeId,
      yandexAppId,
      yandexRewardedId,
      admobRewardedId,
      admobNativeId,
    } = req.body;

    const current = await getOrCreateScratchConfig();

    const nextEnabled = typeof isEnabled === 'boolean' ? isEnabled : current.isEnabled;
    const nextHomeTitle =
      typeof homeTitle === 'string' && homeTitle.trim().length > 0
        ? homeTitle.trim()
        : current.homeTitle;
    const nextHomeSubtitle =
      typeof homeSubtitle === 'string' && homeSubtitle.trim().length > 0
        ? homeSubtitle.trim()
        : current.homeSubtitle;
    const nextHeading =
      typeof heading === 'string' && heading.trim().length > 0
        ? heading.trim()
        : current.heading;
    const nextPopupButtonText =
      typeof popupButtonText === 'string' && popupButtonText.trim().length > 0
        ? popupButtonText.trim()
        : current.popupButtonText;

    const nextTotalCards = Math.max(
      1,
      Math.min(50, Math.floor(Number(totalCards ?? current.totalCards) || current.totalCards))
    );
    const nextMinCoins = Math.max(
      1,
      Math.floor(Number(minCoins ?? current.minCoins) || current.minCoins)
    );
    const nextMaxCoins = Math.max(
      nextMinCoins,
      Math.floor(Number(maxCoins ?? current.maxCoins) || current.maxCoins)
    );
    const nextBannerMaxCoins = Math.max(
      nextMaxCoins,
      Math.floor(Number(bannerMaxCoins ?? current.bannerMaxCoins) || current.bannerMaxCoins)
    );

    const nextRewardedAdNetwork =
      typeof rewardedAdNetwork === 'string' && VALID_REWARDED_NETWORKS.has(rewardedAdNetwork)
        ? rewardedAdNetwork
        : current.rewardedAdNetwork;
    const nextNativeAdNetwork =
      typeof nativeAdNetwork === 'string' && VALID_NATIVE_NETWORKS.has(nativeAdNetwork)
        ? nativeAdNetwork
        : current.nativeAdNetwork;

    const nextNativeAdEveryNCards = Math.max(
      1,
      Math.min(20, Math.floor(Number(nativeAdEveryNCards ?? current.nativeAdEveryNCards) || 4))
    );
    const nextScratchThresholdPercent = Math.max(
      10,
      Math.min(95, Math.floor(Number(scratchThresholdPercent ?? current.scratchThresholdPercent) || 70))
    );

    const nextAdmobRewardedId =
      typeof admobRewardedId === 'string' ? admobRewardedId.trim() : current.admobRewardedId;
    const nextAdmobNativeId =
      typeof admobNativeId === 'string' ? admobNativeId.trim() : current.admobNativeId;

    const nextCardRewards = normalizeCardRewards(
      cardRewards ?? current.cardRewards,
      nextTotalCards,
      nextMinCoins,
      nextMaxCoins
    );

    const dataPayload = {
      isEnabled: nextEnabled,
      homeTitle: nextHomeTitle,
      homeSubtitle: nextHomeSubtitle,
      heading: nextHeading,
      popupButtonText: nextPopupButtonText,
      totalCards: nextTotalCards,
      minCoins: nextMinCoins,
      maxCoins: nextMaxCoins,
      bannerMaxCoins: nextBannerMaxCoins,
      cardRewards: nextCardRewards,
      rewardedAdNetwork: nextRewardedAdNetwork,
      nativeAdNetwork: nextNativeAdNetwork,
      nativeAdEveryNCards: nextNativeAdEveryNCards,
      scratchThresholdPercent: nextScratchThresholdPercent,
      liftoffRewardedId: '',
      liftoffNativeId: '',
      yandexAppId: '',
      yandexRewardedId: '',
      admobRewardedId: nextAdmobRewardedId,
      admobNativeId: nextAdmobNativeId,
    };

    const updated = await prisma.scratchCardConfig.upsert({
      where: { id: 'default' },
      update: dataPayload,
      create: {
        id: 'default',
        ...dataPayload,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Scratch & Win configuration updated live!',
      config: {
        ...updated,
        cardRewards: nextCardRewards,
      },
    });
  } catch (error) {
    console.error('Error updating admin scratch card config:', error);
    res.status(500).json({ error: 'Internal server error while updating scratch card config' });
  }
};
