"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPhone = exports.deleteAccount = exports.updateAvatar = exports.updateProfileDetails = exports.updateBio = exports.recordAdImpression = exports.updateUpi = exports.getTransactions = exports.updateFcmToken = exports.getProfile = void 0;
const db_1 = require("../config/db");
const firebase_1 = require("../config/firebase");
const crypto_1 = require("crypto");
const getProfile = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 20, // Limit to 20 recent transactions
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Exclude passwordHash from response
        const { passwordHash, ...userProfile } = user;
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const gullakClaimsToday = await db_1.prisma.gameSession.count({
            where: {
                userId,
                status: 'completed',
                gameType: { not: 'spin' },
                endTime: { gte: startOfDay }
            }
        });
        // Count referrals referred by this user's code
        const referralCount = await db_1.prisma.user.count({
            where: { referredBy: user.referralCode }
        });
        res.status(200).json({
            user: {
                ...userProfile,
                gullakClaimsToday,
                referralCount
            }
        });
    }
    catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getProfile = getProfile;
const updateFcmToken = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { token } = req.body;
        if (!userId || !token) {
            res.status(400).json({ error: 'Missing user ID or token' });
            return;
        }
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { fcmToken: token }
        });
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error updating FCM token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateFcmToken = updateFcmToken;
const getTransactions = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        // Only query transactions from the last 3 days
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const transactions = await db_1.prisma.transaction.findMany({
            where: {
                userId,
                createdAt: { gte: threeDaysAgo }
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        });
        const total = await db_1.prisma.transaction.count({
            where: {
                userId,
                createdAt: { gte: threeDaysAgo }
            }
        });
        res.status(200).json({
            success: true,
            transactions,
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / limit))
        });
    }
    catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getTransactions = getTransactions;
const updateUpi = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { upiId } = req.body;
        if (!userId || upiId === undefined) {
            res.status(400).json({ error: 'Missing user ID or UPI ID' });
            return;
        }
        // Check for duplicate UPI ID across SikkaPlay accounts
        if (upiId && upiId.trim() !== '') {
            const normalizedUpi = upiId.trim();
            const duplicateUpi = await db_1.prisma.user.findFirst({
                where: {
                    upiId: normalizedUpi,
                    id: { not: userId }
                }
            });
            if (duplicateUpi) {
                res.status(400).json({ error: 'This UPI ID is already linked to another SikkaPlay account' });
                return;
            }
        }
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { upiId: upiId ? upiId.trim() : null }
        });
        res.status(200).json({ success: true, message: 'UPI ID updated successfully' });
    }
    catch (error) {
        console.error('Error updating UPI ID:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateUpi = updateUpi;
const recordAdImpression = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { adType, adNetwork, coinsAwarded, externalTxId } = req.body;
        console.log('[AD IMPRESSION RECEIVED] User:', userId, 'Type:', adType, 'Network:', adNetwork);
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
            return;
        }
        if (!adType || !adNetwork) {
            res.status(400).json({ error: 'adType and adNetwork are required' });
            return;
        }
        const impression = await db_1.prisma.adImpression.create({
            data: {
                userId,
                adType,
                adNetwork,
                coinsAwarded: coinsAwarded || 0,
                externalTxId: externalTxId || null,
                verifiedByServer: false
            }
        });
        res.status(200).json({ success: true, impression });
    }
    catch (error) {
        console.error('Error recording ad impression:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.recordAdImpression = recordAdImpression;
const updateBio = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { bio } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (bio === undefined) {
            res.status(400).json({ error: 'Bio parameter is required' });
            return;
        }
        const cleanBio = bio ? bio.trim() : '';
        if (cleanBio.length > 100) {
            res.status(400).json({ error: 'Bio cannot exceed 100 characters' });
            return;
        }
        const updatedUser = await db_1.prisma.user.update({
            where: { id: userId },
            data: { bio: cleanBio }
        });
        res.status(200).json({ success: true, bio: updatedUser.bio });
    }
    catch (error) {
        console.error('Error updating bio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateBio = updateBio;
const updateProfileDetails = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { name, username, gender, city } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const dataToUpdate = {};
        if (name !== undefined)
            dataToUpdate.name = name ? name.trim() : null;
        if (city !== undefined)
            dataToUpdate.city = city ? city.trim() : null;
        if (gender !== undefined) {
            const cleanGender = gender ? gender.trim() : null;
            dataToUpdate.gender = cleanGender ? (cleanGender.charAt(0).toUpperCase() + cleanGender.slice(1).toLowerCase()) : null;
        }
        if (username !== undefined && username !== null) {
            let cleanUsername = username.toString().trim().toLowerCase();
            if (cleanUsername.startsWith('@'))
                cleanUsername = cleanUsername.substring(1);
            const regex = /^[a-zA-Z0-9_]{3,15}$/;
            if (!regex.test(cleanUsername)) {
                res.status(400).json({ error: 'Username must be 3-15 alphanumeric characters (underscores allowed).' });
                return;
            }
            const existing = await db_1.prisma.user.findFirst({
                where: {
                    username: cleanUsername,
                    NOT: { id: userId }
                }
            });
            if (existing) {
                res.status(400).json({ error: 'This username is already taken by another player.' });
                return;
            }
            dataToUpdate.username = cleanUsername;
        }
        const updatedUser = await db_1.prisma.user.update({
            where: { id: userId },
            data: dataToUpdate
        });
        res.status(200).json({
            success: true,
            name: updatedUser.name,
            username: updatedUser.username,
            gender: updatedUser.gender,
            city: updatedUser.city,
            message: 'Profile updated successfully!'
        });
    }
    catch (error) {
        console.error('Error updating profile details:', error);
        res.status(500).json({ error: error?.message || 'Internal server error' });
    }
};
exports.updateProfileDetails = updateProfileDetails;
const updateAvatar = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { imageBase64 } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!imageBase64) {
            res.status(400).json({ error: 'imageBase64 parameter is required' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Check if the payload is just a preset asset path (Live Custom Avatar) or already http URL
        if (imageBase64.startsWith('assets/') || imageBase64.startsWith('http')) {
            const updatedUser = await db_1.prisma.user.update({
                where: { id: userId },
                data: { avatarUrl: imageBase64 }
            });
            res.status(200).json({ success: true, avatarUrl: updatedUser.avatarUrl });
            return;
        }
        let finalBase64 = imageBase64;
        if (finalBase64.startsWith('data:image')) {
            finalBase64 = finalBase64.replace(/^data:image\/\w+;base64,/, '');
        }
        // Convert base64 to buffer
        const buffer = Buffer.from(finalBase64, 'base64');
        // Upload to Firebase Storage
        const bucket = firebase_1.storage.bucket();
        const token = (0, crypto_1.randomUUID)();
        const fileName = `avatars/${userId}_${Date.now()}.jpg`;
        const file = bucket.file(fileName);
        await file.save(buffer, {
            metadata: {
                contentType: 'image/jpeg',
                metadata: {
                    firebaseStorageDownloadTokens: token,
                }
            },
        });
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
        // Delete old avatar if it's a Firebase Storage URL and not the same
        if (user.avatarUrl && user.avatarUrl.includes('firebasestorage.googleapis.com') && user.avatarUrl !== publicUrl) {
            try {
                const urlObj = new URL(user.avatarUrl);
                const pathname = decodeURIComponent(urlObj.pathname);
                const match = pathname.match(/\/o\/(.+)$/);
                if (match && match[1]) {
                    // match[1] could have query params like ?alt=media, so we strip them
                    const oldFileName = match[1].split('?')[0];
                    const oldFile = bucket.file(oldFileName);
                    await oldFile.delete();
                    console.log(`Deleted old avatar: ${oldFileName}`);
                }
            }
            catch (err) {
                console.error('Error deleting old avatar:', err);
            }
        }
        const updatedUser = await db_1.prisma.user.update({
            where: { id: userId },
            data: { avatarUrl: publicUrl }
        });
        res.status(200).json({ success: true, avatarUrl: updatedUser.avatarUrl });
    }
    catch (error) {
        console.error('Error updating avatar:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
exports.updateAvatar = updateAvatar;
const deleteAccount = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        // Soft delete to avoid foreign key constraint errors with Prisma relations
        // This frees up unique constraints (phone, firebaseUid, username, referralCode)
        await db_1.prisma.user.update({
            where: { id: userId },
            data: {
                phoneNumber: `del_${userId.substring(0, 8)}_${Date.now()}`,
                firebaseUid: `del_${userId.substring(0, 8)}_${Date.now()}`,
                username: `del_${userId.substring(0, 8)}_${Date.now()}`,
                referralCode: `del_${userId.substring(0, 8)}_${Date.now()}`,
                name: 'Deleted User',
                avatarUrl: null,
                bio: null,
                fcmToken: null,
                deviceId: null,
                isBlocked: true,
            }
        });
        res.status(200).json({ success: true, message: 'Account deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.deleteAccount = deleteAccount;
const syncPhone = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Fetch firebase user record using Firebase Admin
        const firebaseRecord = await firebase_1.auth.getUser(user.firebaseUid);
        if (!firebaseRecord.phoneNumber) {
            res.status(400).json({ error: 'No phone number linked to this Firebase account.' });
            return;
        }
        // Ensure the phone number starts with + for standardization
        let formattedPhone = firebaseRecord.phoneNumber;
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = '+91' + formattedPhone;
        }
        // Check if phone is already taken by someone else
        const existing = await db_1.prisma.user.findUnique({ where: { phoneNumber: formattedPhone } });
        if (existing && existing.id !== userId) {
            res.status(400).json({ error: 'Phone number already registered to another account.' });
            return;
        }
        // Update the phone number in our database
        await db_1.prisma.user.update({
            where: { id: userId },
            data: { phoneNumber: formattedPhone }
        });
        res.status(200).json({ success: true, phoneNumber: formattedPhone, message: 'Phone number synced successfully.' });
    }
    catch (error) {
        console.error('Error syncing phone number:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.syncPhone = syncPhone;
