import { Request, Response } from 'express';
import { prisma } from '../config/db';
import crypto from 'crypto';
import https from 'https';

// CPX Research official postback IP whitelist
const CPX_ALLOWED_IPV4 = ['157.90.97.92'];
const CPX_ALLOWED_IPV6 = ['2a01:4f8:d0a:30ff::2'];

const isCpxIpAllowed = (rawIp: string): boolean => {
  if (!rawIp) return false;
  let ip = rawIp.trim().toLowerCase();

  // Strip IPv4-mapped IPv6 prefix (e.g., ::ffff:157.90.97.92)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Exact IPv4 check
  if (CPX_ALLOWED_IPV4.includes(ip)) {
    return true;
  }

  // Exact IPv6 check
  if (CPX_ALLOWED_IPV6.includes(ip)) {
    return true;
  }

  // Subnet match for CPX IPv6 allocation (2a01:4f8:d0a:30ff::/64)
  if (ip.startsWith('2a01:4f8:d0a:30ff:')) {
    return true;
  }

  // Allow localhost for testing when not in production
  if (process.env.NODE_ENV !== 'production') {
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return true;
    }
  }

  return false;
};

const extractCandidateIps = (req: Request): string[] => {
  const ips: string[] = [];

  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    xForwardedFor.split(',').forEach(ip => ips.push(ip.trim()));
  } else if (Array.isArray(xForwardedFor)) {
    xForwardedFor.forEach(ip => ips.push(ip.trim()));
  }

  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string') {
    ips.push(xRealIp.trim());
  }

  if (req.ip) {
    ips.push(req.ip.trim());
  }

  if (req.socket?.remoteAddress) {
    ips.push(req.socket.remoteAddress.trim());
  }

  return [...new Set(ips.filter(Boolean))];
};

export const handleCpxCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. IP Whitelist verification (157.90.97.92 and 2a01:4f8:d0a:30ff::2)
    const candidateIps = extractCandidateIps(req);
    const hasAllowedIp = candidateIps.some(ip => isCpxIpAllowed(ip));

    if (!hasAllowedIp) {
      console.warn(`[CPX Callback] Blocked postback from unauthorized IP(s): ${candidateIps.join(', ')}`);
      res.status(403).send('Forbidden: Unauthorized IP address');
      return;
    }

    // CPX sends parameters via query (GET) or body (POST)
    const data = { ...req.query, ...req.body };
    const userId = (data.user_id || data.userId || data.sub_id || data.subId || '').toString().trim();
    const transactionId = (data.trans_id || data.transId || '').toString().trim();
    const status = data.status;
    const amountVal = (data.amount_local || data.amount || data.coins || '0').toString().trim();
    const incomingHash = (data.secure_hash || data.hash || data.secureHash || '').toString().trim();

    if (!userId || !transactionId || !incomingHash) {
      res.status(400).send('Missing required parameters (user_id, trans_id, secure_hash)');
      return;
    }

    // Verify status (only credit for successful completion, i.e. status = 1 or '1')
    if (status !== '1' && status !== 1) {
      // Acknowledge non-completion (e.g. status 2 chargeback) with 200 OK so CPX doesn't retry
      res.status(200).send('OK');
      return;
    }

    const secureKey = (
      process.env.CPX_SECURE_KEY ||
      process.env.CPX_APP_SECURITY_HASH ||
      process.env.CPX_HASH ||
      ''
    ).trim();

    if (!secureKey) {
      console.error('[CPX Callback] Error: CPX_SECURE_KEY is not configured on server');
      res.status(500).send('CPX callback security key not configured');
      return;
    }

    // 2. Validate MD5 Hash: md5({trans_id}-your App Security Hash)
    const standardHash = crypto.createHash('md5').update(`${transactionId}-${secureKey}`).digest('hex').toLowerCase();
    const extendedHash = crypto.createHash('md5').update(`${transactionId}-${userId}-${amountVal}-${secureKey}`).digest('hex').toLowerCase();
    const directHash = crypto.createHash('md5').update(`${transactionId}${secureKey}`).digest('hex').toLowerCase();

    const incomingLower = incomingHash.toLowerCase();
    if (incomingLower !== standardHash && incomingLower !== extendedHash && incomingLower !== directHash) {
      console.error(`[CPX Callback] Invalid signature hash. Received: "${incomingHash}", Expected: "${standardHash}"`);
      res.status(403).send('Invalid signature hash');
      return;
    }

    const amount = parseInt(amountVal) || 0;
    if (amount <= 0) {
      res.status(200).send('OK');
      return;
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error(`[CPX Callback] User ${userId} not found`);
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

    console.log(`[CPX Callback] Successfully credited ${amount} coins to user ${userId} for transaction ${transactionId}`);
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
