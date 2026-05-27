import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';

/**
 * Frontend pings this every 5 minutes (while app is open and active)
 * Body: { minutes: 5 }
 */
export const logUsage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { minutes, type } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    if (!minutes || typeof minutes !== 'number') {
      res.status(400).json({ error: 'Invalid minutes' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const updateData = type === 'games' ? { gamesMinutes: { increment: minutes } } : { reelsMinutes: { increment: minutes } };
    const createData = type === 'games' ? { gamesMinutes: minutes } : { reelsMinutes: minutes };

    // Upsert the daily usage record
    const usage = await prisma.dailyUsage.upsert({
      where: {
        userId_dateStr: {
          userId,
          dateStr: todayStr,
        }
      },
      update: updateData,
      create: {
        userId,
        dateStr: todayStr,
        ...createData,
      }
    });

    res.status(200).json({ success: true, todayMinutes: type === 'games' ? usage.gamesMinutes : usage.reelsMinutes });
  } catch (error) {
    console.error('Error logging usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
