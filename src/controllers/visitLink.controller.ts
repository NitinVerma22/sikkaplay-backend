import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';
import { invalidateVisitEarnLinksCountCache } from './home.controller';

// --- GET ALL LINKS (USER & ADMIN) ---
export const getVisitLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    const links = await prisma.visitEarnLink.findMany({
      orderBy: { createdAt: 'asc' },
    });

    let linksWithCooldown = links.map(link => ({
      id: link.id,
      title: link.title,
      url: link.url,
      rewardAmount: link.rewardAmount,
      timerSeconds: link.timerSeconds || 15,
      createdAt: link.createdAt,
      cooldownRemaining: 0
    }));

    if (userId) {
      const claims = await prisma.visitEarnClaim.findMany({
        where: { userId },
      });

      const cooldownPeriodMs = 10 * 60 * 1000; // 10 minutes

      linksWithCooldown = links.map(link => {
        const linkClaims = claims.filter(c => c.linkId === link.id);
        if (linkClaims.length > 0) {
          // Sort by claimedAt descending
          linkClaims.sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());
          const latestClaim = linkClaims[0];
          const timeElapsedMs = Date.now() - latestClaim.claimedAt.getTime();
          if (timeElapsedMs < cooldownPeriodMs) {
            const cooldownRemainingSecs = Math.ceil((cooldownPeriodMs - timeElapsedMs) / 1000);
            return {
              id: link.id,
              title: link.title,
              url: link.url,
              rewardAmount: link.rewardAmount,
              timerSeconds: link.timerSeconds || 15,
              createdAt: link.createdAt,
              cooldownRemaining: cooldownRemainingSecs
            };
          }
        }
        return {
          id: link.id,
          title: link.title,
          url: link.url,
          rewardAmount: link.rewardAmount,
          timerSeconds: link.timerSeconds || 15,
          createdAt: link.createdAt,
          cooldownRemaining: 0
        };
      });
    }

    res.status(200).json({
      success: true,
      links: linksWithCooldown,
    });
  } catch (error) {
    console.error('Error fetching visit links:', error);
    res.status(500).json({ error: 'Internal server error while fetching visit links' });
  }
};

// --- CREATE LINK (ADMIN ONLY) ---
export const createVisitLink = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { title, url, rewardAmount, timerSeconds } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'Title is required and must be a string' });
      return;
    }

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL is required and must be a string' });
      return;
    }

    const coinsReward = typeof rewardAmount === 'number' ? rewardAmount : parseInt(rewardAmount) || 5;
    if (coinsReward <= 0) {
      res.status(400).json({ error: 'Coins reward must be greater than 0' });
      return;
    }

    const seconds = typeof timerSeconds === 'number' ? timerSeconds : parseInt(timerSeconds) || 15;

    const newLink = await prisma.visitEarnLink.create({
      data: {
        title: title.trim(),
        url: url.trim(),
        rewardAmount: coinsReward,
        timerSeconds: seconds > 0 ? seconds : 15,
      },
    });

    invalidateVisitEarnLinksCountCache();

    res.status(200).json({
      success: true,
      message: 'Visit link created successfully',
      link: newLink,
    });
  } catch (error) {
    console.error('Error creating visit link:', error);
    res.status(500).json({ error: 'Internal server error while creating visit link' });
  }
};

// --- UPDATE LINK (ADMIN ONLY) ---
export const updateVisitLink = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, url, rewardAmount, timerSeconds } = req.body;

    if (!id) {
      res.status(400).json({ error: 'Link ID is required' });
      return;
    }

    const existing = await prisma.visitEarnLink.findUnique({ where: { id: id as string } });
    if (!existing) {
      res.status(404).json({ error: 'Visit link not found' });
      return;
    }

    const updated = await prisma.visitEarnLink.update({
      where: { id: id as string },
      data: {
        title: title !== undefined ? title.trim() : existing.title,
        url: url !== undefined ? url.trim() : existing.url,
        rewardAmount: rewardAmount !== undefined ? (typeof rewardAmount === 'number' ? rewardAmount : parseInt(rewardAmount) || 5) : existing.rewardAmount,
        timerSeconds: timerSeconds !== undefined ? (typeof timerSeconds === 'number' ? timerSeconds : parseInt(timerSeconds) || 15) : existing.timerSeconds,
      },
    });

    invalidateVisitEarnLinksCountCache();

    res.status(200).json({
      success: true,
      message: 'Visit link updated successfully',
      link: updated,
    });
  } catch (error) {
    console.error('Error updating visit link:', error);
    res.status(500).json({ error: 'Internal server error while updating visit link' });
  }
};

// --- DELETE LINK (ADMIN ONLY) ---
export const deleteVisitLink = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    if (!id) {
      res.status(400).json({ error: 'Link ID is required' });
      return;
    }

    const existingLink = await prisma.visitEarnLink.findUnique({
      where: { id },
    });

    if (!existingLink) {
      res.status(404).json({ error: 'Visit link not found' });
      return;
    }

    await prisma.visitEarnLink.delete({
      where: { id },
    });

    invalidateVisitEarnLinksCountCache();

    res.status(200).json({
      success: true,
      message: 'Visit link deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting visit link:', error);
    res.status(500).json({ error: 'Internal server error while deleting visit link' });
  }
};

// --- CLAIM REWARD (USER ONLY, WITH COOLDOWN VALIDATION) ---
export const claimVisitLinkReward = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const { linkId } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    if (!linkId) {
      res.status(400).json({ error: 'Link ID is required' });
      return;
    }

    // 1. Fetch the link from DB
    const link = await prisma.visitEarnLink.findUnique({
      where: { id: linkId }
    });

    if (!link) {
      res.status(404).json({ error: 'Sponsored link not found' });
      return;
    }

    // 2. Check if user already claimed this link in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentClaim = await prisma.visitEarnClaim.findFirst({
      where: {
        userId,
        linkId,
        claimedAt: { gte: tenMinutesAgo }
      }
    });

    if (recentClaim) {
      const elapsed = Date.now() - recentClaim.claimedAt.getTime();
      const remainingSecs = Math.ceil((10 * 60 * 1000 - elapsed) / 1000);
      res.status(400).json({
        error: `This link is on cooldown. Try again in ${remainingSecs} seconds.`
      });
      return;
    }

    // 3. Process transaction: user balance, transaction record, visit claim record
    const coinsEarned = link.rewardAmount;
    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsEarned },
          totalEarned: { increment: coinsEarned }
        }
      });

      const transactionRecord = await tx.transaction.create({
        data: {
          userId,
          amount: coinsEarned,
          type: 'earning',
          status: 'success',
          description: `Visited sponsored link: ${link.title}`
        }
      });

      const claimRecord = await tx.visitEarnClaim.create({
        data: {
          userId,
          linkId,
        }
      });

      return { user: updatedUser, transaction: transactionRecord, claim: claimRecord };
    });

    res.status(200).json({
      success: true,
      message: 'Reward claimed successfully!',
      coinsEarned,
      newBalance: result.user.balance,
      transaction: result.transaction
    });

  } catch (error) {
    console.error('Error claiming visit link reward:', error);
    res.status(500).json({ error: 'Internal server error while claiming reward' });
  }
};
