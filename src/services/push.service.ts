import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// import * as admin from 'firebase-admin';

// Initialize Firebase Admin here once you have serviceAccountKey.json
// admin.initializeApp({
//   credential: admin.credential.cert(require('../../serviceAccountKey.json')),
// });

export const sendPushNotification = async (fcmToken: string, title: string, body: string) => {
  if (!fcmToken) return;

  try {
    // console.log(`Sending push to ${fcmToken}: ${title} - ${body}`);
    // await admin.messaging().send({
    //   token: fcmToken,
    //   notification: { title, body }
    // });
    console.log(`[MOCK PUSH NOTIFICATION] To: ${fcmToken} | Title: ${title} | Body: ${body}`);

    // Save to database so it appears in the Notification Tab
    const user = await prisma.user.findFirst({ where: { fcmToken } });
    if (user) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title,
          body,
          type: 'alert',
        }
      });
    }

  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};
