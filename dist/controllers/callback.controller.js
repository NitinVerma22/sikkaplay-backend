"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAdmobSsvCallback = exports.handleCpxCallback = void 0;
const db_1 = require("../config/db");
const crypto_1 = __importDefault(require("crypto"));
const https_1 = __importDefault(require("https"));
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
// --- AdMob Server-Side Verification (SSV) ---
let googlePublicKeys = [];
let lastKeyFetchTime = 0;
const fetchGooglePublicKeys = async () => {
    const now = Date.now();
    if (googlePublicKeys.length > 0 && (now - lastKeyFetchTime) < 3600000) {
        return googlePublicKeys;
    }
    return new Promise((resolve) => {
        https_1.default.get('https://gstatic.com/admob/kids/ssv/keys', (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && Array.isArray(parsed.keys)) {
                        googlePublicKeys = parsed.keys;
                        lastKeyFetchTime = now;
                    }
                }
                catch (e) {
                    console.error('Failed to parse Google SSV keys:', e);
                }
                resolve(googlePublicKeys);
            });
        }).on('error', (err) => {
            console.error('Failed to fetch Google SSV keys:', err);
            resolve(googlePublicKeys);
        });
    });
};
const handleAdmobSsvCallback = async (req, res) => {
    try {
        const url = req.url || '';
        const queryString = url.includes('?') ? url.split('?')[1] : '';
        const queryParts = queryString.split('&');
        const filteredParts = queryParts.filter(part => {
            const name = part.split('=')[0];
            return name !== 'signature' && name !== 'key_id';
        });
        const message = filteredParts.join('&');
        const signature = req.query.signature;
        const keyId = req.query.key_id;
        const userId = req.query.user_id;
        const rewardAmountStr = req.query.reward_amount;
        const transactionId = req.query.transaction_id;
        if (!userId || !rewardAmountStr || !transactionId) {
            console.error('AdMob SSV Callback: Missing user_id, reward_amount or transaction_id');
            res.status(400).send('Missing required parameters');
            return;
        }
        const bypassSignature = process.env.BYPASS_ADMOB_SSV_SIGNATURE === 'true';
        if (!bypassSignature) {
            if (!signature || !keyId) {
                console.error('AdMob SSV Callback: Missing signature or key_id');
                res.status(400).send('Missing signature or key_id');
                return;
            }
            const keys = await fetchGooglePublicKeys();
            const matchingKey = keys.find(k => String(k.keyId) === String(keyId));
            if (!matchingKey) {
                console.error(`AdMob SSV Callback: No matching public key found for keyId ${keyId}`);
                res.status(400).send('Invalid key_id');
                return;
            }
            const sigBuffer = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
            const verifier = crypto_1.default.createVerify('sha256');
            verifier.update(message);
            const isValid = verifier.verify(matchingKey.pem, sigBuffer);
            if (!isValid) {
                console.error('AdMob SSV Callback: Cryptographic signature verification failed');
                res.status(403).send('Invalid signature');
                return;
            }
        }
        else {
            console.warn('AdMob SSV Callback: Bypassing signature verification (BYPASS_ADMOB_SSV_SIGNATURE is set to true)');
        }
        const amount = parseInt(rewardAmountStr) || 0;
        // Check if transaction already exists (avoid double claiming)
        const existingTx = await db_1.prisma.transaction.findFirst({
            where: {
                description: {
                    contains: `AdMob-${transactionId}`,
                },
            },
        });
        if (existingTx) {
            res.status(200).send('OK');
            return;
        }
        // Check if user exists
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            console.error(`AdMob SSV Callback: User ${userId} not found`);
            res.status(404).send('User not found');
            return;
        }
        // Execute in a transaction with row lock
        await db_1.prisma.$transaction(async (tx) => {
            // Lock the user row to prevent concurrent race conditions
            await tx.$queryRawUnsafe(`SELECT * FROM "User" WHERE id = $1 FOR UPDATE`, userId);
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
                    description: `Watched Sponsored Video (ID: AdMob-${transactionId})`,
                },
            });
        });
        res.status(200).send('OK');
    }
    catch (error) {
        console.error('Error handling AdMob SSV callback:', error);
        res.status(500).send('Internal server error');
    }
};
exports.handleAdmobSsvCallback = handleAdmobSsvCallback;
