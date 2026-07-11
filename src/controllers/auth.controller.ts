import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { getCachedAppConfig } from '../services/config.service';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

const generateReferralCode = (): string => {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
};

export const registerDirect = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, name, city, gender, referredBy, password, deviceId } = req.body;

    const config = await getCachedAppConfig();
    const allowMultiAccounts = config?.allowMultiAccounts ?? false;
    const refRewardAmount = config?.referralBonus || 500;

    if (!allowMultiAccounts && deviceId) {
      const existingDeviceUser = await prisma.user.findFirst({
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

    let formattedPhone = phoneNumber;
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+91' + formattedPhone;
    }

    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber: formattedPhone }
    });

    if (existingUser) {
      res.status(400).json({ error: 'User already exists. Please login.' });
      return;
    }

    let referrer = null;
    if (referredBy) {
      referrer = await prisma.user.findUnique({ where: { referralCode: referredBy } });
      if (!referrer) {
         res.status(400).json({ error: 'Invalid referral code' });
         return;
      }
    }

    let refCode = generateReferralCode();
    let isUnique = false;
    while (!isUnique) {
      const existing = await prisma.user.findUnique({ where: { referralCode: refCode } });
      if (existing) {
        refCode = generateReferralCode();
      } else {
        isUnique = true;
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const signupBonus = referredBy ? 200 : 100;

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          firebaseUid: formattedPhone, // Fake UID for testing since no firebase
          phoneNumber: formattedPhone,
          passwordHash,
          name: name || null,
          city: city || null,
          gender: gender || null,
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

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({ message: 'Registration successful', token, user });
  } catch (error) {
    console.error('Error in registerDirect:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const loginWithPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, password, deviceId } = req.body;
    
    // Make sure phoneNumber includes country code
    let formattedPhone = phoneNumber;
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+91' + formattedPhone;
    }

    const user = await prisma.user.findUnique({
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

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(400).json({ error: 'Invalid credentials' });
      return;
    }

    const config = await getCachedAppConfig();
    const allowMultiAccounts = config?.allowMultiAccounts ?? false;

    if (deviceId) {
      if (!allowMultiAccounts) {
        const existingDeviceUser = await prisma.user.findFirst({
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
        await prisma.user.update({
          where: { id: user.id },
          data: { deviceId }
        });
        user.deviceId = deviceId;
      }
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(200).json({ message: 'Login successful', token, user });
  } catch (error) {
    console.error('Error in loginWithPassword:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const forgotPassword = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updatedUser = await prisma.user.update({
      where: { phoneNumber: firebaseUser.phone_number },
      data: { passwordHash }
    });

    res.status(200).json({ message: 'Password reset successful', user: updatedUser });
  } catch (error) {
    console.error('Error in forgotPassword:', error);
    res.status(500).json({ error: 'Internal server error or user not found' });
  }
};

export const googleLogin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const firebaseUser = req.user;
    if (!firebaseUser) {
      res.status(401).json({ error: 'Unauthorized. No valid Google token.' });
      return;
    }
    const { deviceId } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { firebaseUid: firebaseUser.uid }
    });

    if (existingUser) {
      if (existingUser.isBlocked) {
        res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact support.' });
        return;
      }

      const config = await getCachedAppConfig();
      const allowMultiAccounts = config?.allowMultiAccounts ?? false;

      if (deviceId) {
        if (!allowMultiAccounts) {
          const existingDeviceUser = await prisma.user.findFirst({
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
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { deviceId }
          });
          existingUser.deviceId = deviceId;
        }
      }

      // User exists, just log them in
      const token = jwt.sign({ userId: existingUser.id }, JWT_SECRET, { expiresIn: '30d' });
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
  } catch (error) {
    console.error('Error in googleLogin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const completeGoogleSignup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firebaseUid, phoneNumber, name, city, referredBy, deviceId } = req.body;

    if (!firebaseUid || !phoneNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const config = await getCachedAppConfig();
    const allowMultiAccounts = config?.allowMultiAccounts ?? false;
    const refRewardAmount = config?.referralBonus || 500;

    if (!allowMultiAccounts && deviceId) {
      const existingDeviceUser = await prisma.user.findFirst({
        where: { deviceId }
      });
      if (existingDeviceUser) {
        res.status(400).json({ error: 'This device is already associated with another account.' });
        return;
      }
    }

    // Format phone number
    let formattedPhone = phoneNumber;
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+91' + formattedPhone;
    }

    // Check if phone number is already taken
    const existingPhone = await prisma.user.findUnique({
      where: { phoneNumber: formattedPhone }
    });

    if (existingPhone) {
      res.status(400).json({ error: 'Phone number already registered to another account' });
      return;
    }

    let referrer = null;
    if (referredBy) {
      referrer = await prisma.user.findUnique({ where: { referralCode: referredBy } });
      if (!referrer) {
         res.status(400).json({ error: 'Invalid referral code' });
         return;
      }
    }

    let refCode = generateReferralCode();
    let isUnique = false;
    while (!isUnique) {
      const existing = await prisma.user.findUnique({ where: { referralCode: refCode } });
      if (existing) {
        refCode = generateReferralCode();
      } else {
        isUnique = true;
      }
    }

    const signupBonus = referredBy ? 200 : 100;

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          firebaseUid: firebaseUid,
          phoneNumber: formattedPhone,
          name: name || null,
          city: city || null,
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

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({ success: true, message: 'Registration successful', token, user });
  } catch (error) {
    console.error('Error in completeGoogleSignup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
