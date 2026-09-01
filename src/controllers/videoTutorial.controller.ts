import { Request, Response } from 'express';
import { prisma } from '../config/db';

export const getVideoTutorialsAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const videos = await prisma.videoTutorial.findMany({ orderBy: { order: 'asc' } });
    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createVideoTutorialAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, url, order } = req.body;
    const video = await prisma.videoTutorial.create({ data: { title, url, order: order || 0 } });
    res.status(201).json(video);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateVideoTutorialAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, url, order } = req.body;
    const video = await prisma.videoTutorial.update({ where: { id: id as string }, data: { title, url, order } });
    res.status(200).json(video);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteVideoTutorialAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.videoTutorial.delete({ where: { id: id as string } });
    res.status(200).json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
