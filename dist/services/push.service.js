"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = void 0;
const db_1 = require("../config/db");
const admin = __importStar(require("firebase-admin"));
require("../config/firebase"); // Ensure Firebase Admin is initialized
const sendPushNotification = async (fcmToken, title, body, type = 'alert', bannerUrl = null) => {
    if (!fcmToken)
        return;
    // 1. Save to database so it appears in the Notification Tab
    try {
        const user = await db_1.prisma.user.findFirst({ where: { fcmToken } });
        if (user) {
            await db_1.prisma.notification.create({
                data: {
                    userId: user.id,
                    title,
                    body,
                    type,
                    bannerUrl,
                }
            });
        }
    }
    catch (dbError) {
        console.error('Error saving notification to DB:', dbError);
    }
    // 2. Send real push notification via FCM
    try {
        console.log(`Sending push to ${fcmToken}: ${title} - ${body} [type: ${type}, banner: ${bannerUrl}]`);
        const message = {
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
    }
    catch (error) {
        console.error('Error sending push notification via FCM:', error);
    }
};
exports.sendPushNotification = sendPushNotification;
