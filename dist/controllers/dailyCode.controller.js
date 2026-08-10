"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDailyCode = exports.deleteDailyCode = exports.getTodayDailyCodeInfo = exports.getDailyCodes = exports.createDailyCode = exports.claimDailyCode = void 0;
const db_1 = require("../config/db");
const date_utils_1 = require("../utils/date.utils");
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
        // Check if the daily code has expired (older than 24 hours)
        const ageInMilliseconds = Date.now() - new Date(dailyCode.createdAt).getTime();
        const ageInHours = ageInMilliseconds / (1000 * 60 * 60);
        if (ageInHours >= 24) {
            res.status(400).json({ error: 'This daily code has expired (valid only for 24 hours)!' });
            return;
        }
        // Check if the daily code is only active on a specific scheduled date
        if (dailyCode.activeDate) {
            const todayIST = (0, date_utils_1.getISTDateString)();
            if (dailyCode.activeDate !== todayIST) {
                res.status(400).json({ error: `This daily code is not active today! It is scheduled for ${dailyCode.activeDate}.` });
                return;
            }
        }
        // 2. Count user's claims for this specific code to enforce exactly 1 claim per user
        const userClaimsCount = await db_1.prisma.dailyCodeClaim.count({
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
        const totalClaimsCount = await db_1.prisma.dailyCodeClaim.count({
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
        const { code, coins, maxClaims, activeDate } = req.body;
        if (!code || typeof code !== 'string') {
            res.status(400).json({ error: 'Code is required' });
            return;
        }
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
        // Split code by commas or newlines to support bulk creation
        const rawCodes = code.split(/[\n,]+/).map(c => c.trim().toUpperCase()).filter(c => c.length > 0);
        if (rawCodes.length === 0) {
            res.status(400).json({ error: 'No valid codes provided' });
            return;
        }
        // Validate that none of the input codes already exist
        const duplicates = await db_1.prisma.dailyCode.findMany({
            where: { code: { in: rawCodes } }
        });
        if (duplicates.length > 0) {
            const dupNames = duplicates.map(d => d.code).join(', ');
            res.status(400).json({ error: `The following codes already exist: ${dupNames}` });
            return;
        }
        // Prepare creation array
        const codesToCreate = [];
        let baseDate = null;
        if (activeDate && typeof activeDate === 'string' && activeDate.trim().length > 0) {
            baseDate = new Date(activeDate);
        }
        for (let i = 0; i < rawCodes.length; i++) {
            let codeActiveDateStr = null;
            if (baseDate) {
                const nextDate = new Date(baseDate.getTime());
                nextDate.setDate(baseDate.getDate() + i);
                const year = nextDate.getFullYear();
                const month = String(nextDate.getMonth() + 1).padStart(2, '0');
                const day = String(nextDate.getDate()).padStart(2, '0');
                codeActiveDateStr = `${year}-${month}-${day}`;
            }
            codesToCreate.push({
                code: rawCodes[i],
                coins: coinsReward,
                maxClaims: maxClaimsVal,
                activeDate: codeActiveDateStr
            });
        }
        // Create all in database
        const createdCodes = await db_1.prisma.$transaction(codesToCreate.map(data => db_1.prisma.dailyCode.create({ data })));
        res.status(200).json({
            success: true,
            message: `Successfully created ${createdCodes.length} daily codes`,
            dailyCodes: createdCodes,
            dailyCode: createdCodes[0]
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
            const ageInMilliseconds = Date.now() - new Date(c.createdAt).getTime();
            const ageInHours = ageInMilliseconds / (1000 * 60 * 60);
            const isExpired = ageInHours >= 24;
            return {
                id: c.id,
                code: c.code,
                coins: c.coins,
                maxClaims: c.maxClaims,
                createdAt: c.createdAt,
                claimsCount,
                totalCoinsPaid,
                claims: c.claims,
                isExpired
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
// getTodayDailyCodeInfo: Fetches today's active (latest) daily code details, limits, and top 3 first claimers
const getTodayDailyCodeInfo = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized: No user ID found' });
            return;
        }
        // Get the latest created daily code
        const latestCode = await db_1.prisma.dailyCode.findFirst({
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
        // Check if the latest code has expired (older than 24 hours)
        const latestAgeInMs = Date.now() - new Date(latestCode.createdAt).getTime();
        const latestAgeInHours = latestAgeInMs / (1000 * 60 * 60);
        if (latestAgeInHours >= 24) {
            res.status(200).json({
                success: true,
                codeExists: false,
                message: 'No active daily code (latest code has expired)'
            });
            return;
        }
        // Map the top 3 claimers
        const claimers = latestCode.claims.map((claim, index) => {
            let displayName = 'User';
            if (claim.user.name && claim.user.name.trim() !== '') {
                displayName = claim.user.name;
            }
            else {
                const phone = claim.user.phoneNumber;
                if (phone.length > 4) {
                    displayName = phone.substring(0, 3) + '***' + phone.substring(phone.length - 4);
                }
                else {
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
        const claimCount = await db_1.prisma.dailyCodeClaim.count({
            where: {
                userId,
                dailyCodeId: latestCode.id
            }
        });
        const hasClaimed = claimCount > 0;
        // Get total claim count across all users
        const totalClaims = await db_1.prisma.dailyCodeClaim.count({
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
    }
    catch (error) {
        console.error('Error fetching today daily code details:', error);
        res.status(500).json({ error: 'Internal server error while fetching today daily code details' });
    }
};
exports.getTodayDailyCodeInfo = getTodayDailyCodeInfo;
// deleteDailyCode: Deletes a daily code by ID
const deleteDailyCode = async (req, res) => {
    try {
        const id = req.params.id;
        const code = await db_1.prisma.dailyCode.findUnique({
            where: { id }
        });
        if (!code) {
            res.status(404).json({ error: 'Daily code not found' });
            return;
        }
        await db_1.prisma.dailyCode.delete({
            where: { id }
        });
        res.status(200).json({
            success: true,
            message: 'Daily code deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting daily code:', error);
        res.status(500).json({ error: 'Internal server error while deleting daily code' });
    }
};
exports.deleteDailyCode = deleteDailyCode;
// updateDailyCode: Updates a daily code by ID
const updateDailyCode = async (req, res) => {
    try {
        const id = req.params.id;
        const { code, coins, maxClaims, activeDate } = req.body;
        const dailyCode = await db_1.prisma.dailyCode.findUnique({
            where: { id }
        });
        if (!dailyCode) {
            res.status(404).json({ error: 'Daily code not found' });
            return;
        }
        const dataToUpdate = {};
        if (code !== undefined && typeof code === 'string') {
            const normalizedCode = code.trim().toUpperCase();
            if (normalizedCode !== dailyCode.code) {
                // Verify if another code already exists with this name
                const existingCode = await db_1.prisma.dailyCode.findUnique({
                    where: { code: normalizedCode }
                });
                if (existingCode) {
                    res.status(400).json({ error: 'This daily code name already exists' });
                    return;
                }
            }
            dataToUpdate.code = normalizedCode;
        }
        if (coins !== undefined) {
            const coinsReward = typeof coins === 'number' ? coins : parseInt(coins) || 0;
            if (coinsReward <= 0) {
                res.status(400).json({ error: 'Coins reward must be greater than 0' });
                return;
            }
            dataToUpdate.coins = coinsReward;
        }
        if (maxClaims !== undefined) {
            const maxClaimsVal = typeof maxClaims === 'number' ? maxClaims : parseInt(maxClaims) || 1;
            if (maxClaimsVal <= 0) {
                res.status(400).json({ error: 'Maximum claims limit must be greater than 0' });
                return;
            }
            dataToUpdate.maxClaims = maxClaimsVal;
        }
        if (activeDate !== undefined) {
            dataToUpdate.activeDate = activeDate;
        }
        const updatedCode = await db_1.prisma.dailyCode.update({
            where: { id },
            data: dataToUpdate
        });
        res.status(200).json({
            success: true,
            message: 'Daily code updated successfully',
            dailyCode: updatedCode
        });
    }
    catch (error) {
        console.error('Error updating daily code:', error);
        res.status(500).json({ error: 'Internal server error while updating daily code' });
    }
};
exports.updateDailyCode = updateDailyCode;
