import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';

const TAPJOY_SECRET = process.env.TAPJOY_VIRTUAL_CURRENCY_SECRET || '';

/**
 * Tapjoy requires a unique numeric user ID for self-managed currency.
 * SikkaPlay's primary user ID is a UUID, so we encode the UUID's 128-bit
 * hex value as a decimal string. This is deterministic, reversible, numeric,
 * and contains no personally identifiable information.
 */
const uuidToTapjoyUserId = (uuid: string): string => {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('Invalid UUID');
  }
  return BigInt(`0x${hex}`).toString(10);
};

const tapjoyUserIdToUuid = (tapjoyUserId: string): string | null => {
  if (!/^\d+$/.test(tapjoyUserId)) return null;

  try {
    const hex = BigInt(tapjoyUserId).toString(16).padStart(32, '0');
    if (hex.length !== 32) return null;

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  } catch (_) {
    return null;
  }
};

const safeEqualHex = (left: string, right: string): boolean => {
  if (!/^[0-9a-fA-F]{32}$/.test(left) || !/^[0-9a-fA-F]{32}$/.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const handleTapjoyCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!TAPJOY_SECRET) {
      console.error('Tapjoy callback: TAPJOY_VIRTUAL_CURRENCY_SECRET is not configured');
      res.status(500).send('Tapjoy callback is not configured');
      return;
    }

    // Tapjoy self-managed currency callbacks are GET requests.
    const snuid = String(req.query.snuid || '').trim();
    const currencyRaw = String(req.query.currency || '').trim();
    const rewardId = String(req.query.id || '').trim();
    const verifier = String(req.query.verifier || '').trim();

    if (!snuid || !currencyRaw || !rewardId || !verifier) {
      res.status(403).send('Invalid Tapjoy callback');
      return;
    }

    if (!/^\d+$/.test(currencyRaw)) {
      res.status(403).send('Invalid reward amount');
      return;
    }

    const amount = Number(currencyRaw);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      res.status(403).send('Invalid reward amount');
      return;
    }

    // Tapjoy verifier = MD5(id:snuid:currency:secret_key)
    const expectedVerifier = crypto
      .createHash('md5')
      .update(`${rewardId}:${snuid}:${currencyRaw}:${TAPJOY_SECRET}`)
      .digest('hex');

    if (!safeEqualHex(verifier, expectedVerifier)) {
      console.error('Tapjoy callback: invalid verifier');
      res.status(403).send('Invalid verifier');
      return;
    }

    const userId = tapjoyUserIdToUuid(snuid);
    if (!userId) {
      console.error(`Tapjoy callback: invalid numeric snuid ${snuid}`);
      res.status(403).send('Unknown user');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      console.error(`Tapjoy callback: user ${userId} not found for snuid ${snuid}`);
      res.status(403).send('Unknown user');
      return;
    }

    const externalTxId = `tapjoy-${rewardId}`;

    // Tapjoy may retry callbacks. A unique external transaction ID makes the
    // reward idempotent and prevents the same conversion from being credited twice.
    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId },
      select: { id: true },
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Lock the user row so concurrent callbacks cannot race the balance update.
      await tx.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, userId);

      // Re-check after the lock to handle two simultaneous identical callbacks.
      const duplicate = await tx.transaction.findUnique({
        where: { externalTransactionId: externalTxId },
        select: { id: true },
      });

      if (duplicate) return;

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: { increment: amount },
          totalEarned: { increment: amount },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          amount,
          type: 'earning',
          status: 'success',
          description: `Completed Tapjoy Offerwall reward (ID: ${rewardId})`,
          externalTransactionId: externalTxId,
        },
      });
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling Tapjoy callback:', error);
    res.status(500).send('Internal server error');
  }
};

export { uuidToTapjoyUserId };
