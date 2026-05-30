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

    // 1. Check if user has already claimed any daily code today
    const startOfToday = getStartOfTodayIST();
    const alreadyClaimedToday = await prisma.dailyCodeClaim.findFirst({
      where: {
        userId,
        createdAt: { gte: startOfToday }
      }
    });

    if (alreadyClaimedToday) {
      res.status(400).json({ error: 'You have already claimed a daily code today' });
      return;
    }

    // 2. Fetch the target daily code
    const dailyCode = await prisma.dailyCode.findUnique({
      where: { code: normalizedCode }
    });

    if (!dailyCode) {
      res.status(400).json({ error: 'Invalid code of the day. Please check and try again!' });
      return;
    }

    // 3. Verify user hasn't claimed this specific code ever (in case admin re-uses codes)
    const alreadyClaimedThisCode = await prisma.dailyCodeClaim.findUnique({
      where: {
        userId_dailyCodeId: {
          userId,
          dailyCodeId: dailyCode.id
        }
      }
    });

    if (alreadyClaimedThisCode) {
      res.status(400).json({ error: 'You have already claimed this daily code' });
      return;
    }

    // 4. Generate random reward between 200 and 2000 coins
    const coinsEarned = Math.floor(Math.random() * (2000 - 200 + 1)) + 200;

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
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    // Verify if this code already exists
    const existingCode = await prisma.dailyCode.findUnique({
      where: { code: normalizedCode }
    });

    if (existingCode) {
      res.status(400).json({ error: 'This daily code already exists' });
      return;
    }

    const newDailyCode = await prisma.dailyCode.create({
      data: { code: normalizedCode }
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
