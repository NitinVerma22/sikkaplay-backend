import { Request, Response } from 'express';
import { prisma } from '../config/db';
import crypto from 'crypto';
import https from 'https';

export const handleCpxCallback = async (req: Request, res: Response): Promise<void> => {
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
      const defaultHash = crypto.createHash('md5').update(defaultData).digest('hex');

      // Format 2: Extended: md5(trans_id + "-" + user_id + "-" + amount_local + "-" + secureKey)
      const extendedData = `${trans_id}-${user_id}-${amount_local}-${secureKey}`;
      const extendedHash = crypto.createHash('md5').update(extendedData).digest('hex');

      if (hash !== defaultHash && hash !== extendedHash) {
        console.error('CPX Callback: Invalid signature hash');
        res.status(403).send('Invalid signature');
        return;
      }
    }

    const userId = user_id as string;
    const amount = parseInt(amount_local as string) || 0;
    const transactionId = trans_id as string;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error(`CPX Callback: User ${userId} not found`);
      res.status(404).send('User not found');
      return;
    }

    const externalTxId = `cpx-${transactionId}`;

    // Check if transaction already exists (avoid double claiming)
    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId }
    });

    if (existingTx) {
      // Return ok immediately to prevent CPX retries
      res.status(200).send('OK');
      return;
    }

    // Execute in a transaction
    await prisma.$transaction(async (tx) => {
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
          externalTransactionId: externalTxId,
        },
      });
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling CPX callback:', error);
    res.status(500).send('Internal server error');
  }
};

// --- AdMob Server-Side Verification (SSV) ---

let googlePublicKeys: any[] = [];
let lastKeyFetchTime = 0;

const fetchGooglePublicKeys = async (): Promise<any[]> => {
  const now = Date.now();
  if (googlePublicKeys.length > 0 && (now - lastKeyFetchTime) < 3600000) {
    return googlePublicKeys;
  }
  return new Promise((resolve) => {
    https.get('https://gstatic.com/admob/kids/ssv/keys', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && Array.isArray(parsed.keys)) {
            googlePublicKeys = parsed.keys;
            lastKeyFetchTime = now;
          }
        } catch (e) {
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

export const handleAdmobSsvCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const url = req.url || '';
    const queryString = url.includes('?') ? url.split('?')[1] : '';
    const queryParts = queryString.split('&');
    const filteredParts = queryParts.filter(part => {
      const name = part.split('=')[0];
      return name !== 'signature' && name !== 'key_id';
    });
    const message = filteredParts.join('&');

    const signature = req.query.signature as string;
    const keyId = req.query.key_id as string;

    const userId = req.query.user_id as string;
    const rewardAmountStr = req.query.reward_amount as string;
    const transactionId = req.query.transaction_id as string;

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
      const verifier = crypto.createVerify('sha256');
      verifier.update(message);
      const isValid = verifier.verify(matchingKey.pem, sigBuffer);

      if (!isValid) {
        console.error('AdMob SSV Callback: Cryptographic signature verification failed');
        res.status(403).send('Invalid signature');
        return;
      }
    } else {
      console.warn('AdMob SSV Callback: Bypassing signature verification (BYPASS_ADMOB_SSV_SIGNATURE is set to true)');
    }

    const amount = parseInt(rewardAmountStr) || 0;

    const externalTxId = `admob-${transactionId}`;

    // Check if transaction already exists (avoid double claiming)
    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId }
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error(`AdMob SSV Callback: User ${userId} not found`);
      res.status(404).send('User not found');
      return;
    }

    // Execute in a transaction with row lock
    await prisma.$transaction(async (tx) => {
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
          externalTransactionId: externalTxId,
        },
      });
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling AdMob SSV callback:', error);
    res.status(500).send('Internal server error');
  }
};
