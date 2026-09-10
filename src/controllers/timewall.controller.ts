import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';

const TIMEWALL_SECRET = process.env.TIMEWALL_SECRET_KEY || '';

const safeEqualSha256 = (left: string, right: string): boolean => {
  if (!/^[0-9a-fA-F]{64}$/.test(left) || !/^[0-9a-fA-F]{64}$/.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getClientIp = (req: Request): string => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || '';
};

const normalizeIp = (ip: string): string => {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
};

const TIMEWALL_ALLOWED_IPS = new Set([
  '18.156.132.55',
  '51.81.120.73',
  '142.111.248.18',
]);

export const handleTimewallCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!TIMEWALL_SECRET) {
      console.error('TimeWall callback: TIMEWALL_SECRET_KEY is not configured');
      res.status(500).send('TimeWall callback is not configured');
      return;
    }

    // TimeWall postbacks use the exact values sent in the query string.
    // Keep revenue as a string because the hash is calculated from its exact representation.
    const userId = String(req.query.userid || req.query.userID || '').trim();
    const transactionId = String(req.query.txid || req.query.transactionID || '').trim();
    const revenue = String(req.query.revenue ?? '').trim();
    const currencyRaw = String(req.query.currencyAmount ?? '').trim();
    const hash = String(req.query.hash || '').trim().toLowerCase();
    const type = String(req.query.type || '1').trim();
    const offerName = String(req.query.offername || '').trim();
    const offerDetail = String(req.query.offerdetail || '').trim();

    if (!userId || !transactionId || !revenue || !currencyRaw || !hash) {
      res.status(400).send('Invalid TimeWall callback');
      return;
    }

    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(revenue) || Number(revenue) < 0) {
      res.status(400).send('Invalid revenue');
      return;
    }

    if (!/^\d+$/.test(currencyRaw)) {
      res.status(400).send('Invalid currency amount');
      return;
    }

    const currencyAmount = Number(currencyRaw);
    if (!Number.isSafeInteger(currencyAmount) || currencyAmount <= 0) {
      res.status(400).send('Invalid currency amount');
      return;
    }

    if (type !== '1' && type !== '2') {
      res.status(400).send('Invalid transaction type');
      return;
    }

    // TimeWall dashboard rule: SHA256(userID + revenue + SecretKey).
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${userId}${revenue}${TIMEWALL_SECRET}`)
      .digest('hex');

    if (!safeEqualSha256(hash, expectedHash)) {
      console.error(`TimeWall callback: invalid hash for transaction ${transactionId}`);
      res.status(403).send('Invalid hash');
      return;
    }

    // Enforce the publisher IP allowlist supplied by TimeWall.
    const clientIp = normalizeIp(getClientIp(req));
    if (clientIp && !TIMEWALL_ALLOWED_IPS.has(clientIp)) {
      console.error(`TimeWall callback: rejected IP ${clientIp}`);
      res.status(403).send('Forbidden');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      console.error(`TimeWall callback: user ${userId} not found`);
      res.status(404).send('Unknown user');
      return;
    }

    const creditTxId = `timewall-${transactionId}-1`;
    const reversalTxId = `timewall-${transactionId}-2`;
    const externalTxId = type === '1' ? creditTxId : reversalTxId;

    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId },
      select: { id: true },
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, userId);

      const duplicate = await tx.transaction.findUnique({
        where: { externalTransactionId: externalTxId },
        select: { id: true },
      });

      if (duplicate) return;

      if (type === '1') {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { increment: currencyAmount },
            totalEarned: { increment: currencyAmount },
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: currencyAmount,
            type: 'earning',
            status: 'success',
            description: `Completed TimeWall Offerwall reward${offerName ? `: ${offerName}` : ''} (ID: ${transactionId})`,
            externalTransactionId: externalTxId,
          },
        });
      } else {
        // A type=2 postback is a TimeWall reversal/chargeback. Only reverse a
        // conversion that we previously credited and do it once.
        const original = await tx.transaction.findUnique({
          where: { externalTransactionId: creditTxId },
          select: { id: true },
        });

        if (!original) {
          throw new Error(`TimeWall reversal received before original credit: ${transactionId}`);
        }

        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { decrement: currencyAmount },
            totalEarned: { decrement: currencyAmount },
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            amount: -currencyAmount,
            type: 'earning',
            status: 'success',
            description: `TimeWall Offerwall reversal${offerDetail ? `: ${offerDetail}` : ''} (ID: ${transactionId})`,
            externalTransactionId: externalTxId,
          },
        });
      }
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling TimeWall callback:', error);
    res.status(500).send('Internal server error');
  }
};
