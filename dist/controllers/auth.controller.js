"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeGoogleSignup = exports.googleLogin = exports.forgotPassword = exports.loginWithPassword = exports.registerDirect = void 0;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const config_service_1 = require("../services/config.service");
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const generateReferralCode = () => {
    return crypto_1.default.randomBytes(3).toString('hex').toUpperCase();
};
const registerDirect = async (req, res) => {
    try {
        const { phoneNumber, name, city, gender, referredBy, password, deviceId, username } = req.body;
        const config = await (0, config_service_1.getCachedAppConfig)();
        const allowMultiAccounts = config?.allowMultiAccounts ?? false;
        const refRewardAmount = config?.referralBonus || 500;
        if (!allowMultiAccounts && deviceId) {
            const existingDeviceUser = await db_1.prisma.user.findFirst({
                where: { deviceId }
            });
            if (existingDeviceUser) {
                res.status(400).json({ error: 'This device is already associated with another account.' });
                return;
            }
        }
        if (!phoneNumber) {
            res.status(400).json({ error: 'Phone number is required' });
            return;
        }
        if (!password || password.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }
        if (!username) {
            res.status(400).json({ error: 'Username is required' });
            return;
        }
        let cleanUsername = username.toString().trim().toLowerCase();
        if (cleanUsername.startsWith('@')) {
            cleanUsername = cleanUsername.substring(1);
        }
        const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
        if (!usernameRegex.test(cleanUsername)) {
            res.status(400).json({ error: 'Username must be 3-15 alphanumeric characters and can contain underscores.' });
            return;
        }
        const existingUsername = await db_1.prisma.user.findUnique({
            where: { username: cleanUsername }
        });
        if (existingUsername) {
            res.status(400).json({ error: 'Username is already taken by another player.' });
            return;
        }
        let formattedPhone = phoneNumber;
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = '+91' + formattedPhone;
        }
        const existingUser = await db_1.prisma.user.findUnique({
            where: { phoneNumber: formattedPhone }
        });
        if (existingUser) {
            res.status(400).json({ error: 'User already exists. Please login.' });
            return;
        }
        let referrer = null;
        if (referredBy) {
            referrer = await db_1.prisma.user.findUnique({ where: { referralCode: referredBy } });
            if (!referrer) {
                res.status(400).json({ error: 'Invalid referral code' });
                return;
            }
        }
        let refCode = generateReferralCode();
        let isUnique = false;
        while (!isUnique) {
            const existing = await db_1.prisma.user.findUnique({ where: { referralCode: refCode } });
            if (existing) {
                refCode = generateReferralCode();
            }
            else {
                isUnique = true;
            }
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const signupBonus = referredBy ? 200 : 100;
        const formattedGender = gender ? (gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()) : null;
        const user = await db_1.prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    firebaseUid: formattedPhone, // Fake UID for testing since no firebase
                    phoneNumber: formattedPhone,
                    passwordHash,
                    name: name || null,
                    username: cleanUsername,
                    city: city || null,
                    gender: formattedGender,
                    referralCode: refCode,
                    referredBy: referredBy || null,
                    balance: signupBonus,
                    totalEarned: signupBonus,
                    deviceId: deviceId || null,
                }
            });
            await tx.transaction.create({
                data: {
                    userId: newUser.id,
                    amount: signupBonus,
                    type: 'bonus',
                    status: 'success',
                    description: referredBy ? 'Signup Bonus (Referred)' : 'Welcome Bonus',
                }
            });
            if (referrer) {
                // Reward the referrer
                await tx.user.update({
                    where: { id: referrer.id },
                    data: {
                        referralBalance: { increment: refRewardAmount }
                    }
                });
                // Create referral transaction for the referrer
                await tx.transaction.create({
                    data: {
                        userId: referrer.id,
                        amount: refRewardAmount,
                        type: 'network_income',
                        status: 'success',
                        description: `Referral Reward: Referred ${newUser.name || newUser.phoneNumber}`,
                    }
                });
            }
            return newUser;
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.status(200).json({ message: 'Registration successful', token, user });
    }
    catch (error) {
        console.error('Error in registerDirect:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.registerDirect = registerDirect;
const loginWithPassword = async (req, res) => {
    try {
        const { phoneNumber, password, deviceId } = req.body;
        // Make sure phoneNumber includes country code
        let formattedPhone = phoneNumber;
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = '+91' + formattedPhone;
        }
        const user = await db_1.prisma.user.findUnique({
            where: { phoneNumber: formattedPhone }
        });
        if (!user) {
            res.status(404).json({ error: 'User not registered' });
            return;
        }
        if (user.isBlocked) {
            res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact support.' });
            return;
        }
        if (!user.passwordHash) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }
        const config = await (0, config_service_1.getCachedAppConfig)();
        const allowMultiAccounts = config?.allowMultiAccounts ?? false;
        if (deviceId) {
            if (!allowMultiAccounts) {
                const existingDeviceUser = await db_1.prisma.user.findFirst({
                    where: {
                        deviceId,
                        id: { not: user.id }
                    }
                });
                if (existingDeviceUser) {
                    res.status(400).json({ error: 'This device is already associated with another account.' });
                    return;
                }
            }
            if (user.deviceId !== deviceId) {
                await db_1.prisma.user.update({
                    where: { id: user.id },
                    data: { deviceId }
                });
                user.deviceId = deviceId;
            }
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.status(200).json({ message: 'Login successful', token, user });
    }
    catch (error) {
        console.error('Error in loginWithPassword:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.loginWithPassword = loginWithPassword;
const forgotPassword = async (req, res) => {
    try {
        const firebaseUser = req.user;
        const { newPassword } = req.body;
        if (!firebaseUser || !firebaseUser.phone_number) {
            res.status(400).json({ error: 'Phone number not found in token' });
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 10);
        const updatedUser = await db_1.prisma.user.update({
            where: { phoneNumber: firebaseUser.phone_number },
            data: { passwordHash }
        });
        res.status(200).json({ message: 'Password reset successful', user: updatedUser });
    }
    catch (error) {
        console.error('Error in forgotPassword:', error);
        res.status(500).json({ error: 'Internal server error or user not found' });
    }
};
exports.forgotPassword = forgotPassword;
const googleLogin = async (req, res) => {
    try {
        const firebaseUser = req.user;
        if (!firebaseUser) {
            res.status(401).json({ error: 'Unauthorized. No valid Google token.' });
            return;
        }
        const { deviceId } = req.body;
        // Check if user already exists
        const existingUser = await db_1.prisma.user.findUnique({
            where: { firebaseUid: firebaseUser.uid }
        });
        if (existingUser) {
            if (existingUser.isBlocked) {
                res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact support.' });
                return;
            }
            const config = await (0, config_service_1.getCachedAppConfig)();
            const allowMultiAccounts = config?.allowMultiAccounts ?? false;
            if (deviceId) {
                if (!allowMultiAccounts) {
                    const existingDeviceUser = await db_1.prisma.user.findFirst({
                        where: {
                            deviceId,
                            id: { not: existingUser.id }
                        }
                    });
                    if (existingDeviceUser) {
                        res.status(400).json({ error: 'This device is already associated with another account.' });
                        return;
                    }
                }
                if (existingUser.deviceId !== deviceId) {
                    await db_1.prisma.user.update({
                        where: { id: existingUser.id },
                        data: { deviceId }
                    });
                    existingUser.deviceId = deviceId;
                }
            }
            // User exists, just log them in
            const token = jsonwebtoken_1.default.sign({ userId: existingUser.id }, JWT_SECRET, { expiresIn: '30d' });
            res.status(200).json({ success: true, message: 'Login successful', token, user: existingUser });
            return;
        }
        // User doesn't exist, they need to complete their profile
        res.status(200).json({
            success: true,
            action: 'REQUIRE_PROFILE_COMPLETION',
            firebaseUid: firebaseUser.uid,
            email: firebaseUser.email,
            name: firebaseUser.name
        });
    }
    catch (error) {
        console.error('Error in googleLogin:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.googleLogin = googleLogin;
const completeGoogleSignup = async (req, res) => {
    try {
        const { firebaseUid, email, name, city, gender, referredBy, deviceId, username, phoneNumber } = req.body;
        if (!firebaseUid) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        if (!username) {
            res.status(400).json({ error: 'Username is required' });
            return;
        }
        let cleanUsername = username.toString().trim().toLowerCase();
        if (cleanUsername.startsWith('@')) {
            cleanUsername = cleanUsername.substring(1);
        }
        const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
        if (!usernameRegex.test(cleanUsername)) {
            res.status(400).json({ error: 'Username must be 3-15 alphanumeric characters and can contain underscores.' });
            return;
        }
        const existingUsername = await db_1.prisma.user.findUnique({
            where: { username: cleanUsername }
        });
        if (existingUsername) {
            res.status(400).json({ error: 'Username is already taken by another player.' });
            return;
        }
        const config = await (0, config_service_1.getCachedAppConfig)();
        const allowMultiAccounts = config?.allowMultiAccounts ?? false;
        const refRewardAmount = config?.referralBonus || 500;
        if (!allowMultiAccounts && deviceId) {
            const existingDeviceUser = await db_1.prisma.user.findFirst({
                where: { deviceId }
            });
            if (existingDeviceUser) {
                res.status(400).json({ error: 'This device is already associated with another account.' });
                return;
            }
        }
        // Use provided phone number or fallback to a dummy phone number for Google users
        let formattedPhone = phoneNumber;
        if (formattedPhone) {
            if (!formattedPhone.startsWith('+')) {
                formattedPhone = '+91' + formattedPhone;
            }
        }
        else {
            formattedPhone = `G-${firebaseUid.substring(0, 10)}`;
        }
        // Check if phone number is already taken
        const existingPhone = await db_1.prisma.user.findUnique({
            where: { phoneNumber: formattedPhone }
        });
        if (existingPhone) {
            res.status(400).json({ error: 'Phone number already registered to another account' });
            return;
        }
        let referrer = null;
        if (referredBy) {
            referrer = await db_1.prisma.user.findUnique({ where: { referralCode: referredBy } });
            if (!referrer) {
                res.status(400).json({ error: 'Invalid referral code' });
                return;
            }
        }
        let refCode = generateReferralCode();
        let isUnique = false;
        while (!isUnique) {
            const existing = await db_1.prisma.user.findUnique({ where: { referralCode: refCode } });
            if (existing) {
                refCode = generateReferralCode();
            }
            else {
                isUnique = true;
            }
        }
        const signupBonus = referredBy ? 200 : 100;
        const formattedGender = gender ? (gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()) : null;
        const user = await db_1.prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    firebaseUid: firebaseUid,
                    email: email || null,
                    phoneNumber: formattedPhone,
                    name: name || null,
                    username: cleanUsername,
                    city: city || null,
                    gender: formattedGender,
                    referralCode: refCode,
                    referredBy: referredBy || null,
                    balance: signupBonus,
                    totalEarned: signupBonus,
                    deviceId: deviceId || null,
                }
            });
            await tx.transaction.create({
                data: {
                    userId: newUser.id,
                    amount: signupBonus,
                    type: 'bonus',
                    status: 'success',
                    description: referredBy ? 'Google Signup Bonus (Referred)' : 'Google Welcome Bonus',
                }
            });
            if (referrer) {
                // Reward the referrer
                await tx.user.update({
                    where: { id: referrer.id },
                    data: {
                        referralBalance: { increment: refRewardAmount }
                    }
                });
                // Create referral transaction for the referrer
                await tx.transaction.create({
                    data: {
                        userId: referrer.id,
                        amount: refRewardAmount,
                        type: 'network_income',
                        status: 'success',
                        description: `Referral Reward: Referred ${newUser.name || newUser.phoneNumber}`,
                    }
                });
            }
            return newUser;
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.status(200).json({ success: true, message: 'Registration successful', token, user });
    }
    catch (error) {
        console.error('Error in completeGoogleSignup:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.completeGoogleSignup = completeGoogleSignup;
