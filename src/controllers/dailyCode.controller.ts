import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';
import { getStartOfTodayIST } from '../utils/date.utils';

// --- USER ENDPOINTS ---

// claimDailyCode: Allows users to enter a daily code and claim a reward
export const claimDailyCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { code } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found in session' });
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Invalid code provided' });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    // 1. Fetch the target daily code
    const dailyCode = await prisma.dailyCode.findUnique({
      where: { code: normalizedCode }
    });

    if (!dailyCode) {
      res.status(400).json({ error: 'Invalid code of the day. Please check and try again!' });
      return;
    }

    // 2. Count user's claims for this specific code to enforce exactly 1 claim per user
    const userClaimsCount = await prisma.dailyCodeClaim.count({
      where: {
        userId,
        dailyCodeId: dailyCode.id
      }
    });

    if (userClaimsCount >= 1) {
      res.status(400).json({ error: 'You have already claimed this daily code!' });
      return;
    }

    // 3. Count total claims across all users to enforce the global limit
    const totalClaimsCount = await prisma.dailyCodeClaim.count({
      where: {
        dailyCodeId: dailyCode.id
      }
    });

    if (totalClaimsCount >= dailyCode.maxClaims) {
      res.status(400).json({ error: 'This daily code has reached its maximum claim limit! Better luck next time.' });
      return;
    }

    // 3. Use the coins reward assigned to this daily code
    const coinsEarned = dailyCode.coins;

    // 5. Execute transaction: update balance, create transaction, create claim record
    const result = await prisma.$transaction(async (tx) => {
      // Update user balances
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: coinsEarned },
          totalEarned: { increment: coinsEarned }
        }
      });

      // Create transaction
      const transactionRecord = await tx.transaction.create({
        data: {
          userId,
          amount: coinsEarned,
          type: 'earning',
          status: 'success',
          description: `Daily Code Claim: ${normalizedCode}`
        }
      });

      // Create claim
      const claimRecord = await tx.dailyCodeClaim.create({
        data: {
          userId,
          dailyCodeId: dailyCode.id,
          coinsEarned
        }
      });

      return { user: updatedUser, transaction: transactionRecord, claim: claimRecord };
    });

    res.status(200).json({
      success: true,
      message: 'Code claimed successfully!',
      coinsEarned,
      newBalance: result.user.balance,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('Error claiming daily code:', error);
    res.status(500).json({ error: 'Internal server error while claiming daily code' });
  }
};


// --- ADMIN ENDPOINTS ---

// createDailyCode: Allows admins to create/register a new daily code
export const createDailyCode = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { code, coins, maxClaims } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();
    const coinsReward = typeof coins === 'number' ? coins : parseInt(coins) || 0;
    const maxClaimsVal = typeof maxClaims === 'number' ? maxClaims : parseInt(maxClaims) || 1;

    if (coinsReward <= 0) {
      res.status(400).json({ error: 'Coins reward must be a positive number greater than 0' });
      return;
    }

    if (maxClaimsVal <= 0) {
      res.status(400).json({ error: 'Maximum claims limit must be greater than 0' });
      return;
    }

    // Verify if this code already exists
    const existingCode = await prisma.dailyCode.findUnique({
      where: { code: normalizedCode }
    });

    if (existingCode) {
      res.status(400).json({ error: 'This daily code already exists' });
      return;
    }

    const newDailyCode = await prisma.dailyCode.create({
      data: { 
        code: normalizedCode,
        coins: coinsReward,
        maxClaims: maxClaimsVal
      }
    });

    res.status(200).json({
      success: true,
      message: 'Daily code created successfully',
      dailyCode: newDailyCode
    });
  } catch (error) {
    console.error('Error creating daily code:', error);
    res.status(500).json({ error: 'Internal server error while creating daily code' });
  }
};

// getDailyCodes: Returns a list of daily codes and metadata on how many times each has been claimed
export const getDailyCodes = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const codes = await prisma.dailyCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        claims: {
          select: {
            id: true,
            coinsEarned: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                phoneNumber: true
              }
            }
          }
        }
      }
    });

    const formattedCodes = codes.map((c) => {
      const claimsCount = c.claims.length;
      const totalCoinsPaid = c.claims.reduce((sum, claim) => sum + claim.coinsEarned, 0);

      return {
        id: c.id,
        code: c.code,
        coins: c.coins,
        maxClaims: c.maxClaims,
        createdAt: c.createdAt,
        claimsCount,
        totalCoinsPaid,
        claims: c.claims
      };
    });

    res.status(200).json({
      success: true,
      dailyCodes: formattedCodes
    });
  } catch (error) {
    console.error('Error fetching daily codes stats:', error);
    res.status(500).json({ error: 'Internal server error while fetching daily codes stats' });
  }
};

// getTodayDailyCodeInfo: Fetches today's active (latest) daily code details, limits, and top 3 first claimers
export const getTodayDailyCodeInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    // Get the latest created daily code
    const latestCode = await prisma.dailyCode.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        claims: {
          orderBy: { createdAt: 'asc' }, // Chronological order (first claimers first)
          take: 3,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phoneNumber: true
              }
            }
          }
        }
      }
    });

    if (!latestCode) {
      res.status(200).json({
        success: true,
        codeExists: false,
        message: 'No daily code active'
      });
      return;
    }

    // Map the top 3 claimers
    const claimers = latestCode.claims.map((claim, index) => {
      let displayName = 'User';
      if (claim.user.name && claim.user.name.trim() !== '') {
        displayName = claim.user.name;
      } else {
        const phone = claim.user.phoneNumber;
        if (phone.length > 4) {
          displayName = phone.substring(0, 3) + '***' + phone.substring(phone.length - 4);
        } else {
          displayName = 'User';
        }
      }
      return {
        name: displayName,
        rank: index + 1,
        claimedAt: claim.createdAt
      };
    });

    // Check if the current user has claimed this code
    const claimCount = await prisma.dailyCodeClaim.count({
      where: {
        userId,
        dailyCodeId: latestCode.id
      }
    });
    const hasClaimed = claimCount > 0;

    // Get total claim count across all users
    const totalClaims = await prisma.dailyCodeClaim.count({
      where: {
        dailyCodeId: latestCode.id
      }
    });

    res.status(200).json({
      success: true,
      codeExists: true,
      code: latestCode.code,
      coins: latestCode.coins,
      maxClaims: latestCode.maxClaims, // total allowed claims
      totalClaims, // total claims done so far
      hasClaimed,
      claimers
    });
  } catch (error) {
    console.error('Error fetching today daily code details:', error);
    res.status(500).json({ error: 'Internal server error while fetching today daily code details' });
  }
};

