import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';

const ADGEM_POSTBACK_KEY = process.env.ADGEM_POSTBACK_KEY || '';
const ADGEM_ALLOWED_IPS = new Set(
  String(process.env.ADGEM_ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
);

const safeTimingEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeIp = (ip: string): string => {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
};

const getClientIp = (req: Request): string => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return normalizeIp(forwarded || req.ip || req.socket.remoteAddress || '');
};

/**
 * AdGem GET postback (v2).
 *
 * AdGem appends request_id and verifier to the configured GET URL. The verifier
 * is HMAC-SHA256 of the exact postback URL without the verifier parameter.
 */
export const handleAdgemCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!ADGEM_POSTBACK_KEY) {
      console.error('AdGem callback: ADGEM_POSTBACK_KEY is not configured');
      res.status(500).send('AdGem callback is not configured');
      return;
    }

    if (ADGEM_ALLOWED_IPS.size > 0) {
      const clientIp = getClientIp(req);
      if (!ADGEM_ALLOWED_IPS.has(clientIp)) {
        console.error(`AdGem callback: rejected IP ${clientIp}`);
        res.status(403).send('Forbidden');
        return;
      }
    }

    const verifier = String(req.query.verifier || '').trim();
    const requestId = String(req.query.request_id || '').trim();
    const playerId = String(req.query.player_id || '').trim();
    const amountRaw = String(req.query.amount ?? '').trim();
    const payoutRaw = String(req.query.payout ?? '').trim();
    const conversionId = String(req.query.conversion_id || '').trim();
    const campaignId = String(req.query.campaign_id || '').trim();
    const offerId = String(req.query.offer_id || '').trim();
    const offerName = String(req.query.offer_name || '').trim();
    const goalName = String(req.query.goal_name || '').trim();
    const country = String(req.query.country || '').trim().toUpperCase();
    const conversionType = String(req.query.conversion_type || '').trim().toLowerCase();

    if (!verifier || !requestId || !playerId) {
      res.status(400).send('Missing required parameters');
      return;
    }

    // Reconstruct the exact URL AdGem signed, preserving the original query
    // parameter order/encoding and removing only the verifier parameter.
    const [path, rawQuery = ''] = req.originalUrl.split('?');
    const hashlessQuery = rawQuery
      .split('&')
      .filter((part) => part && !part.startsWith('verifier='))
      .join('&');

    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    const host = req.get('host');
    if (!host) {
      res.status(400).send('Missing host');
      return;
    }

    const hashlessUrl = `${protocol}://${host}${path}${hashlessQuery ? `?${hashlessQuery}` : ''}`;
    const expectedVerifier = crypto
      .createHmac('sha256', ADGEM_POSTBACK_KEY)
      .update(hashlessUrl, 'utf8')
      .digest('hex');

    if (!safeTimingEqual(expectedVerifier, verifier)) {
      console.error(`AdGem callback: invalid verifier for request ${requestId}`);
      res.status(403).send('Invalid verifier');
      return;
    }

    // Install events can be sent for tracking with amount=0. They must not
    // credit Sikka. Reward postbacks carry a positive amount.
    if (!amountRaw || !/^(?:0|[1-9]\d*)$/.test(amountRaw)) {
      res.status(400).send('Invalid amount');
      return;
    }

    const amount = Number(amountRaw);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      res.status(400).send('Invalid amount');
      return;
    }

    if (amount === 0 || conversionType === 'install') {
      console.log(`AdGem callback: non-reward conversion ${conversionType || 'unknown'} for request ${requestId}`);
      res.status(200).send('OK');
      return;
    }

    const externalId = `adgem-${conversionId || requestId}`;

    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalId },
      select: { id: true },
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true },
    });

    if (!user) {
      console.error(`AdGem callback: user ${playerId} not found for request ${requestId}`);
      res.status(404).send('Unknown user');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, playerId);

      const duplicate = await tx.transaction.findUnique({
        where: { externalTransactionId: externalId },
        select: { id: true },
      });

      if (duplicate) return;

      await tx.user.update({
        where: { id: playerId },
        data: {
          balance: { increment: amount },
          totalEarned: { increment: amount },
        },
      });

      await tx.transaction.create({
        data: {
          userId: playerId,
          amount,
          type: 'earning',
          status: 'success',
          description: `Completed AdGem offer${offerName ? `: ${offerName}` : ''}${goalName ? ` (${goalName})` : ''} (Conversion: ${conversionId || requestId})`,
          externalTransactionId: externalId,
        },
      });
    });

    console.log(
      `AdGem callback: credited ${amount} Sikka to ${playerId}` +
      ` request=${requestId}` +
      `${campaignId ? ` campaign=${campaignId}` : ''}` +
      `${offerId ? ` offer=${offerId}` : ''}` +
      `${payoutRaw ? ` payout=${payoutRaw}` : ''}` +
      `${country ? ` country=${country}` : ''}`,
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling AdGem callback:', error);
    res.status(500).send('Internal server error');
  }
};
