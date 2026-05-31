import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';

// --- GET ALL LINKS (USER & ADMIN) ---
export const getVisitLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    const links = await prisma.visitEarnLink.findMany({
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json({
      success: true,
      links,
    });
  } catch (error) {
    console.error('Error fetching visit links:', error);
    res.status(500).json({ error: 'Internal server error while fetching visit links' });
  }
};

// --- CREATE LINK (ADMIN ONLY) ---
export const createVisitLink = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { title, url, rewardAmount } = req.body;

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

    const newLink = await prisma.visitEarnLink.create({
      data: {
        title: title.trim(),
        url: url.trim(),
        rewardAmount: coinsReward,
      },
    });

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

    res.status(200).json({
      success: true,
      message: 'Visit link deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting visit link:', error);
    res.status(500).json({ error: 'Internal server error while deleting visit link' });
  }
};
