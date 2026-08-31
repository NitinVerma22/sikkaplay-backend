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
        ...(channelName ? { channelName } : {})
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
  bannerUrl: string | null = null
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
          ...(bannerUrl ? { bannerUrl } : {})
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

