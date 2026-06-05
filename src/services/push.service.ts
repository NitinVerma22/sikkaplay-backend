import { prisma } from '../config/db';
import * as admin from 'firebase-admin';
import '../config/firebase'; // Ensure Firebase Admin is initialized

export const sendPushNotification = async (
  fcmToken: string, 
  title: string, 
  body: string, 
  type: string = 'alert', 
  bannerUrl: string | null = null
) => {
  if (!fcmToken) return;

  // 1. Save to database so it appears in the Notification Tab
  try {
    const user = await prisma.user.findFirst({ where: { fcmToken } });
    if (user) {
      await prisma.notification.create({
        data: {
          userId: user.id,
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

  // 2. Send real push notification via FCM
  try {
    console.log(`Sending push to ${fcmToken}: ${title} - ${body} [type: ${type}, banner: ${bannerUrl}]`);
    
    const message: any = {
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sikkaplay_high_channel',
          color: '#7C3AED', // App brand theme color (Purple)
          icon: 'ic_launcher',
        }
      }
    };

    if (bannerUrl && bannerUrl.trim() !== '') {
      message.notification.imageUrl = bannerUrl;
    }

    await admin.messaging().send(message);
  } catch (error) {
    console.error('Error sending push notification via FCM:', error);
  }
};
