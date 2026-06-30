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
exports.sendPushNotificationBatch = exports.sendPushNotification = void 0;
const db_1 = require("../config/db");
const admin = __importStar(require("firebase-admin"));
require("../config/firebase"); // Ensure Firebase Admin is initialized
const sendPushNotification = async (fcmToken, title, body, type = 'alert', bannerUrl = null, userId, skipDb = false, senderId) => {
    if (!fcmToken)
        return;
    // 1. Save to database so it appears in the Notification Tab
    if (!skipDb) {
        try {
            const uId = userId || (await db_1.prisma.user.findFirst({ where: { fcmToken } }))?.id;
            if (uId) {
                await db_1.prisma.notification.create({
                    data: {
                        userId: uId,
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
    }
    // 2. Send real push notification via FCM
    try {
        console.log(`Sending push to ${fcmToken}: ${title} - ${body} [type: ${type}, banner: ${bannerUrl}]`);
        const message = {
            token: fcmToken,
            notification: { title, body },
            data: {
                title,
                body,
                type,
                ...(bannerUrl ? { bannerUrl } : {}),
                ...(senderId ? { senderId } : {})
            },
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
            if (message.android && message.android.notification) {
                message.android.notification.imageUrl = bannerUrl;
            }
        }
        await admin.messaging().send(message);
    }
    catch (error) {
        console.error('Error sending push notification via FCM:', error);
    }
};
exports.sendPushNotification = sendPushNotification;
const sendPushNotificationBatch = async (tokens, title, body, type = 'alert', bannerUrl = null) => {
    if (!tokens || tokens.length === 0)
        return;
    const batchSize = 500;
    for (let i = 0; i < tokens.length; i += batchSize) {
        const tokenBatch = tokens.slice(i, i + batchSize);
        const messages = tokenBatch.map(token => {
            const message = {
                token,
                notification: { title, body },
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'sikkaplay_high_channel',
                        color: '#7C3AED',
                        icon: 'ic_launcher',
                    }
                }
            };
            if (bannerUrl && bannerUrl.trim() !== '') {
                message.notification.imageUrl = bannerUrl;
                if (message.android && message.android.notification) {
                    message.android.notification.imageUrl = bannerUrl;
                }
            }
            return message;
        });
        try {
            console.log(`Sending batch of ${messages.length} push notifications...`);
            const response = await admin.messaging().sendEach(messages);
            console.log(`Successfully sent ${response.successCount} messages; failed ${response.failureCount} messages.`);
        }
        catch (error) {
            console.error('Error sending batch push notifications via FCM:', error);
        }
    }
};
exports.sendPushNotificationBatch = sendPushNotificationBatch;
