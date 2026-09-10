import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';

const CPALEAD_POSTBACK_PASSWORD = process.env.CPALEAD_POSTBACK_PASSWORD || '';
const CPALEAD_POINTS_PER_USD = Number(process.env.CPALEAD_POINTS_PER_USD || '85000');

// CPAlead's current publisher postback relay IP.
const CPALEAD_ALLOWED_IPS = new Set(['34.69.179.33']);

const getClientIp = (req: Request): string => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || '';
};

const normalizeIp = (ip: string): string => {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
};

const safeTimingEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const handleCpaleadCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!CPALEAD_POSTBACK_PASSWORD) {
      console.error('CPAlead callback: CPALEAD_POSTBACK_PASSWORD is not configured');
      res.status(500).send('CPAlead callback is not configured');
      return;
    }

    if (!Number.isFinite(CPALEAD_POINTS_PER_USD) || CPALEAD_POINTS_PER_USD <= 0) {
      console.error('CPAlead callback: CPALEAD_POINTS_PER_USD is invalid');
      res.status(500).send('CPAlead callback is not configured');
      return;
    }

    const clientIp = normalizeIp(getClientIp(req));
    if (clientIp && !CPALEAD_ALLOWED_IPS.has(clientIp)) {
      console.error(`CPAlead callback: rejected IP ${clientIp}`);
      res.status(403).send('Forbidden');
      return;
    }

    // CPAlead publisher postbacks use GET query parameters.
    const subId = String(req.query.subid || '').trim();
    const leadId = String(req.query.lead_id || req.query.transaction_id || '').trim();
    const campaignId = String(req.query.campaign_id || req.query.offer_id || '').trim();
    const campaignName = String(req.query.campaign_name || req.query.offer_name || '').trim();
    const payoutRaw = String(req.query.payout ?? req.query.amount ?? '').trim();
    const eventKey = String(req.query.event_key || '').trim();
    const eventName = String(req.query.event_name || '').trim();
    const eventPayoutRaw = String(req.query.event_payout ?? '').trim();
    const countryIso = String(req.query.country_iso || req.query.country_code || '').trim().toUpperCase();
    const password = String(req.query.password || '');

    if (!subId || !leadId || !payoutRaw || !password) {
      res.status(400).send('Missing required parameters');
      return;
    }

    if (!safeTimingEqual(password, CPALEAD_POSTBACK_PASSWORD)) {
      console.error(`CPAlead callback: invalid postback password for lead ${leadId}`);
      res.status(403).send('Invalid postback password');
      return;
    }

    // Keep payout as a string until validated. CPAlead sends payout as the
    // advertiser conversion value in USD and it must not be trusted blindly.
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(payoutRaw)) {
      res.status(400).send('Invalid payout');
      return;
    }

    const payout = Number(payoutRaw);
    if (!Number.isFinite(payout) || payout <= 0) {
      res.status(400).send('Invalid payout');
      return;
    }

    const rewardAmount = Math.floor(payout * CPALEAD_POINTS_PER_USD + Number.EPSILON);
    if (!Number.isSafeInteger(rewardAmount) || rewardAmount <= 0) {
      res.status(400).send('Invalid reward amount');
      return;
    }

    const externalTxId = `cpalead-${leadId}`;

    // lead_id is CPAlead's unique conversion identifier. It is the idempotency
    // key so CPAlead retries can never double-credit the same conversion.
    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId },
      select: { id: true },
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: subId },
      select: { id: true },
    });

    if (!user) {
      console.error(`CPAlead callback: user ${subId} not found for lead ${leadId}`);
      res.status(404).send('Unknown user');
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Lock the user row so concurrent postbacks cannot race on the balance.
      await tx.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, subId);

      const duplicate = await tx.transaction.findUnique({
        where: { externalTransactionId: externalTxId },
        select: { id: true },
      });

      if (duplicate) return;

      await tx.user.update({
        where: { id: subId },
        data: {
          balance: { increment: rewardAmount },
          totalEarned: { increment: rewardAmount },
        },
      });

      await tx.transaction.create({
        data: {
          userId: subId,
          amount: rewardAmount,
          type: 'earning',
          status: 'success',
          description: `Completed CPAlead Offerwall offer${campaignName ? `: ${campaignName}` : ''}${eventName ? ` (${eventName})` : ''} (Lead: ${leadId})`,
          externalTransactionId: externalTxId,
        },
      });
    });

    console.log(
      `CPAlead callback: credited ${rewardAmount} Sikka to ${subId} for lead ${leadId}` +
      `${campaignId ? ` campaign ${campaignId}` : ''}` +
      `${eventKey ? ` event ${eventKey}` : ''}` +
      `${eventPayoutRaw ? ` event_payout=${eventPayoutRaw}` : ''}` +
      `${countryIso ? ` country=${countryIso}` : ''}`,
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling CPAlead callback:', error);
    res.status(500).send('Internal server error');
  }
};
