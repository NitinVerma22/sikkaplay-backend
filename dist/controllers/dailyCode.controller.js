"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDailyCodes = exports.createDailyCode = exports.claimDailyCode = void 0;
const db_1 = require("../config/db");
// --- USER ENDPOINTS ---
// claimDailyCode: Allows users to enter a daily code and claim a reward
const claimDailyCode = async (req, res) => {
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
        const dailyCode = await db_1.prisma.dailyCode.findUnique({
            where: { code: normalizedCode }
        });
        if (!dailyCode) {
            res.status(400).json({ error: 'Invalid code of the day. Please check and try again!' });
            return;
        }
        // 2. Count user's claims for this specific code
        const userClaimsCount = await db_1.prisma.dailyCodeClaim.count({
            where: {
                userId,
                dailyCodeId: dailyCode.id
            }
        });
        if (userClaimsCount >= dailyCode.maxClaims) {
            res.status(400).json({
                error: dailyCode.maxClaims === 1
                    ? 'You have already claimed this daily code!'
                    : `You have reached the maximum claim limit for this code (Max: ${dailyCode.maxClaims})`
            });
            return;
        }
        // 3. Use the coins reward assigned to this daily code
        const coinsEarned = dailyCode.coins;
        // 5. Execute transaction: update balance, create transaction, create claim record
        const result = await db_1.prisma.$transaction(async (tx) => {
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
    }
    catch (error) {
        console.error('Error claiming daily code:', error);
        res.status(500).json({ error: 'Internal server error while claiming daily code' });
    }
};
exports.claimDailyCode = claimDailyCode;
// --- ADMIN ENDPOINTS ---
// createDailyCode: Allows admins to create/register a new daily code
const createDailyCode = async (req, res) => {
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
        const existingCode = await db_1.prisma.dailyCode.findUnique({
            where: { code: normalizedCode }
        });
        if (existingCode) {
            res.status(400).json({ error: 'This daily code already exists' });
            return;
        }
        const newDailyCode = await db_1.prisma.dailyCode.create({
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
    }
    catch (error) {
        console.error('Error creating daily code:', error);
        res.status(500).json({ error: 'Internal server error while creating daily code' });
    }
};
exports.createDailyCode = createDailyCode;
// getDailyCodes: Returns a list of daily codes and metadata on how many times each has been claimed
const getDailyCodes = async (req, res) => {
    try {
        const codes = await db_1.prisma.dailyCode.findMany({
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
    }
    catch (error) {
        console.error('Error fetching daily codes stats:', error);
        res.status(500).json({ error: 'Internal server error while fetching daily codes stats' });
    }
};
exports.getDailyCodes = getDailyCodes;
