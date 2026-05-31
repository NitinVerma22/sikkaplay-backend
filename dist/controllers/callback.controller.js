"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCpxCallback = void 0;
const db_1 = require("../config/db");
const crypto_1 = __importDefault(require("crypto"));
const handleCpxCallback = async (req, res) => {
    try {
        // CPX sends parameters via query (GET) or body (POST)
        const data = { ...req.query, ...req.body };
        const { user_id, amount_local, trans_id, status, hash } = data;
        if (!user_id || !amount_local || !trans_id || !hash) {
            res.status(400).send('Missing required parameters');
            return;
        }
        // Verify status (only credit for successful completion, i.e. status = 1 or '1')
        if (status !== '1' && status !== 1) {
            res.status(200).send('Status is not success completion');
            return;
        }
        const secureKey = process.env.CPX_SECURE_KEY || '';
        if (secureKey) {
            // Calculate MD5 hash formats
            // Format 1: Default CPX: md5(trans_id + "-" + secureKey)
            const defaultData = `${trans_id}-${secureKey}`;
            const defaultHash = crypto_1.default.createHash('md5').update(defaultData).digest('hex');
            // Format 2: Extended: md5(trans_id + "-" + user_id + "-" + amount_local + "-" + secureKey)
            const extendedData = `${trans_id}-${user_id}-${amount_local}-${secureKey}`;
            const extendedHash = crypto_1.default.createHash('md5').update(extendedData).digest('hex');
            if (hash !== defaultHash && hash !== extendedHash) {
                console.error('CPX Callback: Invalid signature hash');
                res.status(403).send('Invalid signature');
                return;
            }
        }
        const userId = user_id;
        const amount = parseInt(amount_local) || 0;
        const transactionId = trans_id;
        // Check if user exists
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            console.error(`CPX Callback: User ${userId} not found`);
            res.status(404).send('User not found');
            return;
        }
        // Check if transaction already exists (avoid double claiming)
        const existingTx = await db_1.prisma.transaction.findFirst({
            where: {
                description: {
                    contains: `CPX-${transactionId}`,
                },
            },
        });
        if (existingTx) {
            // Return ok immediately to prevent CPX retries
            res.status(200).send('OK');
            return;
        }
        // Execute in a transaction
        await db_1.prisma.$transaction(async (tx) => {
            // 1. Update user balance
            await tx.user.update({
                where: { id: userId },
                data: {
                    balance: { increment: amount },
                    totalEarned: { increment: amount },
                },
            });
            // 2. Create transaction record
            await tx.transaction.create({
                data: {
                    userId,
                    amount,
                    type: 'earning',
                    status: 'success',
                    description: `Completed CPX Survey (ID: CPX-${transactionId})`,
                },
            });
        });
        res.status(200).send('OK');
    }
    catch (error) {
        console.error('Error handling CPX callback:', error);
        res.status(500).send('Internal server error');
    }
};
exports.handleCpxCallback = handleCpxCallback;
