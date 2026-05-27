import { Request, Response } from 'express';

export const getAppConfig = async (req: Request, res: Response) => {
  try {
    // These values can be set in Render Environment Variables
    // Default version is 1.0.0
    const latestVersion = process.env.LATEST_APP_VERSION || '1.0.0';
    
    // The Firebase Hosting URL where the APK will be uploaded
    const updateUrl = process.env.APK_DOWNLOAD_URL || 'https://sikkaplay-apk.web.app/app-release.apk';
    
    // Whether this update is mandatory (users cannot skip it)
    const forceUpdate = process.env.FORCE_UPDATE === 'true';

    res.status(200).json({
      success: true,
      data: {
        latestVersion,
        updateUrl,
        forceUpdate
      }
    });
  } catch (error) {
    console.error('Error fetching app config:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch config' });
  }
};
