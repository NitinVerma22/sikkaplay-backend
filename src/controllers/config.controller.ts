import { Request, Response } from 'express';
import { prisma } from '../config/db';

export const getAppConfig = async (req: Request, res: Response) => {
  try {
    let config = await prisma.appConfig.findFirst();
    if (!config) {
      config = await prisma.appConfig.create({
        data: {}
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...config,
        latestVersion: config.latestAppVersion,
        updateUrl: config.apkDownloadUrl,
      }
    });
  } catch (error) {
    console.error('Error fetching app config:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch config' });
  }
};
