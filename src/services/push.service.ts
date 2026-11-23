import { prisma } from '../config/db';
import * as admin from 'firebase-admin';
import '../config/firebase'; // Ensure Firebase Admin is initialized

export const sendPushNotification = async (
  fcmToken: string, 
  title: string, 
  body: string, 
  type: string = 'alert', 
  bannerUrl: string | null = null,
  userId?: string,
  skipDb: boolean = false,
  senderId?: string,
  channelName?: string
) => {
  if (!fcmToken) return;

  // 1. Save to database so it appears in the Notification Tab
  if (!skipDb) {
    try {
      const uId = userId || (await prisma.user.findFirst({ where: { fcmToken } }))?.id;
      if (uId) {
        await prisma.notification.create({
          data: {
            userId: uId,
            title,
            body,
            type,
            bannerUrl,
          }
        });
      }
    } catch (dbError) {
      console.error('Error saving notification to DB:', dbError);
    }
  }

  // 2. Send real push notification via FCM
  try {
    console.log(`Sending push to ${fcmToken}: ${title} - ${body} [type: ${type}, banner: ${bannerUrl}]`);
    
    const message: any = {
      token: fcmToken,
      data: {
        title,
        body,
        type,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        ...(bannerUrl ? { bannerUrl } : {}),
        ...(senderId ? { senderId, partnerId: senderId } : {}),
        ...(channelName ? { channelName, tournamentId: channelName } : {})
      },
      android: { priority: 'high' }
    };

    if (bannerUrl && bannerUrl.trim() !== '') {
      // Data-only message, flutter will handle the image download from bannerUrl
    }

    await admin.messaging().send(message);
  } catch (error: any) {
    console.error('Error sending push notification via FCM:', error);
    console.error('[FCM FAILURE CATCH]', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      name: error?.name
    });
  }
};

export const sendPushNotificationBatch = async (
  tokens: string[],
  title: string,
  body: string,
  type: string = 'alert',
  bannerUrl: string | null = null,
  tournamentId?: string
) => {
  if (!tokens || tokens.length === 0) return;

  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const tokenBatch = tokens.slice(i, i + batchSize);
    const messages = tokenBatch.map(token => {
      const message: any = {
        token,
        data: {
          title,
          body,
          type,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...(bannerUrl ? { bannerUrl } : {}),
          ...(tournamentId ? { tournamentId, channelName: tournamentId } : {})
        },
        android: {
          priority: 'high' as const
        }
      };

      if (bannerUrl && bannerUrl.trim() !== '') {
        // Data-only message, flutter will handle the image download from bannerUrl
      }

      return message;
    });

    try {
      console.log(`Sending batch of ${messages.length} push notifications...`);
      const response = await admin.messaging().sendEach(messages);
      console.log(`Successfully sent ${response.successCount} messages; failed ${response.failureCount} messages.`);
      
      if (response.failureCount > 0) {
        response.responses.forEach((resp, index) => {
          if (!resp.success && resp.error) {
            console.error('[FCM FAILURE]', {
              code: resp.error.code,
              message: resp.error.message,
              details: (resp.error as any).details,
              name: (resp.error as any).name,
              index
            });
          }
        });
      }
    } catch (error: any) {
      console.error('Error sending batch push notifications via FCM:', error);
      console.error('[FCM FAILURE CATCH]', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        name: error?.name
      });
    }
  }
};

/**
 * Broadcasts a push notification to all users with valid FCM tokens and persists in-app notification records in DB.
 */
export const broadcastPushNotification = async (params: {
  title: string;
  body: string;
  type?: string;
  bannerUrl?: string | null;
  tournamentId?: string;
  skipDb?: boolean;
}): Promise<void> => {
  const { title, body, type = 'alert', bannerUrl = null, tournamentId, skipDb = false } = params;

  try {
    // 1. Fetch all users to obtain IDs and FCM tokens
    const users = await prisma.user.findMany({
      select: {
        id: true,
        fcmToken: true
      }
    });

    if (!users || users.length === 0) return;

    // 2. Persist in-app notifications in DB in chunks of 1000 so all users see it in their notification inbox
    if (!skipDb) {
      try {
        const dbEntries = users.map(u => ({
          userId: u.id,
          title,
          body,
          type,
          bannerUrl: bannerUrl || null,
        }));

        const chunkSize = 1000;
        for (let i = 0; i < dbEntries.length; i += chunkSize) {
          const chunk = dbEntries.slice(i, i + chunkSize);
          await prisma.notification.createMany({ data: chunk });
        }
      } catch (dbErr) {
        console.error('[broadcastPushNotification] Error inserting notifications into DB:', dbErr);
      }
    }

    // 3. Send real push notifications via FCM in batches of 500
    const tokens = users
      .filter(u => u.fcmToken && u.fcmToken.trim().length > 10)
      .map(u => u.fcmToken!.trim());

    if (tokens.length > 0) {
      console.log(`[broadcastPushNotification] Dispatching push to ${tokens.length} registered devices...`);
      await sendPushNotificationBatch(tokens, title, body, type, bannerUrl, tournamentId);
    }
  } catch (error) {
    console.error('[broadcastPushNotification] Error broadcasting push notification:', error);
  }
};

