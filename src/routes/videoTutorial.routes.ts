import { Router } from 'express';
import { prisma } from '../config/db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const videos = await prisma.videoTutorial.findMany({ orderBy: { order: 'asc' } });
    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
