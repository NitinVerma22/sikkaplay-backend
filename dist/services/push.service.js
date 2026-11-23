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
exports.broadcastPushNotification = exports.sendPushNotificationBatch = exports.sendPushNotification = void 0;
const db_1 = require("../config/db");
const admin = __importStar(require("firebase-admin"));
require("../config/firebase"); // Ensure Firebase Admin is initialized
const sendPushNotification = async (fcmToken, title, body, type = 'alert', bannerUrl = null, userId, skipDb = false, senderId, channelName) => {
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
    }
    catch (error) {
        console.error('Error sending push notification via FCM:', error);
        console.error('[FCM FAILURE CATCH]', {
            code: error?.code,
            message: error?.message,
            details: error?.details,
            name: error?.name
        });
    }
};
exports.sendPushNotification = sendPushNotification;
const sendPushNotificationBatch = async (tokens, title, body, type = 'alert', bannerUrl = null, tournamentId) => {
    if (!tokens || tokens.length === 0)
        return;
    const batchSize = 500;
    for (let i = 0; i < tokens.length; i += batchSize) {
        const tokenBatch = tokens.slice(i, i + batchSize);
        const messages = tokenBatch.map(token => {
            const message = {
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
                    priority: 'high'
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
                            details: resp.error.details,
                            name: resp.error.name,
                            index
                        });
                    }
                });
            }
        }
        catch (error) {
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
exports.sendPushNotificationBatch = sendPushNotificationBatch;
/**
 * Broadcasts a push notification to all users with valid FCM tokens and persists in-app notification records in DB.
 */
const broadcastPushNotification = async (params) => {
    const { title, body, type = 'alert', bannerUrl = null, tournamentId, skipDb = false } = params;
    try {
        // 1. Fetch all users to obtain IDs and FCM tokens
        const users = await db_1.prisma.user.findMany({
            select: {
                id: true,
                fcmToken: true
            }
        });
        if (!users || users.length === 0)
            return;
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
                    await db_1.prisma.notification.createMany({ data: chunk });
                }
            }
            catch (dbErr) {
                console.error('[broadcastPushNotification] Error inserting notifications into DB:', dbErr);
            }
        }
        // 3. Send real push notifications via FCM in batches of 500
        const tokens = users
            .filter(u => u.fcmToken && u.fcmToken.trim().length > 10)
            .map(u => u.fcmToken.trim());
        if (tokens.length > 0) {
            console.log(`[broadcastPushNotification] Dispatching push to ${tokens.length} registered devices...`);
            await (0, exports.sendPushNotificationBatch)(tokens, title, body, type, bannerUrl, tournamentId);
        }
    }
    catch (error) {
        console.error('[broadcastPushNotification] Error broadcasting push notification:', error);
    }
};
exports.broadcastPushNotification = broadcastPushNotification;
