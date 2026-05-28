"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = void 0;
const db_1 = require("../config/db");
// import * as admin from 'firebase-admin';
// Initialize Firebase Admin here once you have serviceAccountKey.json
// admin.initializeApp({
//   credential: admin.credential.cert(require('../../serviceAccountKey.json')),
// });
const sendPushNotification = async (fcmToken, title, body) => {
    if (!fcmToken)
        return;
    try {
        // console.log(`Sending push to ${fcmToken}: ${title} - ${body}`);
        // await admin.messaging().send({
        //   token: fcmToken,
        //   notification: { title, body }
        // });
        console.log(`[MOCK PUSH NOTIFICATION] To: ${fcmToken} | Title: ${title} | Body: ${body}`);
        // Save to database so it appears in the Notification Tab
        const user = await db_1.prisma.user.findFirst({ where: { fcmToken } });
        if (user) {
            await db_1.prisma.notification.create({
                data: {
                    userId: user.id,
                    title,
                    body,
                    type: 'alert',
                }
            });
        }
    }
    catch (error) {
        console.error('Error sending push notification:', error);
    }
};
exports.sendPushNotification = sendPushNotification;
