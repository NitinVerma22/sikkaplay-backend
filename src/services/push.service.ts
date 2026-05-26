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
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};
