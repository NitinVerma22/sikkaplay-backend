import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';

const ADSCALEX_SIGNING_SECRET = process.env.ADSCALEX_SIGNING_SECRET || '';
const ADSCALEX_POINTS_PER_USD = Number(process.env.ADSCALEX_POINTS_PER_USD || '85000');

const safeTimingEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getHeader = (req: Request, name: string): string => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').trim();
};

const getRawBody = (req: Request): string | null => {
  const raw = (req as Request & { rawBody?: Buffer | string }).rawBody;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (typeof raw === 'string') return raw;
  return null;
};

export const handleAdscalexCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!ADSCALEX_SIGNING_SECRET) {
      console.error('AdScaleX callback: ADSCALEX_SIGNING_SECRET is not configured');
      res.status(500).send('AdScaleX callback is not configured');
      return;
    }

    if (!Number.isFinite(ADSCALEX_POINTS_PER_USD) || ADSCALEX_POINTS_PER_USD <= 0) {
      console.error('AdScaleX callback: ADSCALEX_POINTS_PER_USD is invalid');
      res.status(500).send('AdScaleX callback is not configured');
      return;
    }

    const rawBody = getRawBody(req);
    if (rawBody === null) {
      console.error('AdScaleX callback: raw request body is unavailable');
      res.status(400).send('Raw body required');
      return;
    }

    const timestamp = getHeader(req, 'x-adscalex-timestamp') || getHeader(req, 'x-timestamp');
    const signature = getHeader(req, 'x-adscalex-signature') || getHeader(req, 'x-signature');

    if (!timestamp || !signature) {
      res.status(400).send('Missing signature headers');
      return;
    }

    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) {
      res.status(400).send('Invalid timestamp');
      return;
    }

    // Reject stale/future callbacks while allowing a small amount of clock skew.
    const timestampMs = timestamp.length >= 13 ? timestampNumber : timestampNumber * 1000;
    const ageMs = Math.abs(Date.now() - timestampMs);
    const maxAgeMs = 5 * 60 * 1000;
    if (!Number.isFinite(timestampMs) || ageMs > maxAgeMs) {
      console.error(`AdScaleX callback: stale timestamp ${timestamp}`);
      res.status(403).send('Stale timestamp');
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', ADSCALEX_SIGNING_SECRET)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex');

    if (!safeTimingEqual(expectedSignature, signature)) {
      console.error('AdScaleX callback: invalid signature');
      res.status(403).send('Invalid signature');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.status(400).send('Invalid JSON');
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).send('Invalid payload');
      return;
    }

    const body = payload as Record<string, unknown>;
    const eventId = String(body.event_id || '').trim();
    const publisherAppId = String(body.publisher_app_id || '').trim();
    const publisherUserId = String(body.publisher_user_id || '').trim();
    const campaignId = String(body.campaign_id || '').trim();
    const amountRaw = String(body.amount ?? '').trim();
    const currency = String(body.currency || '').trim().toUpperCase();
    const occurredAtRaw = String(body.occurred_at || '').trim();

    if (!eventId || !publisherAppId || !publisherUserId || !amountRaw || !currency || !occurredAtRaw) {
      res.status(400).send('Missing required parameters');
      return;
    }

    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amountRaw)) {
      res.status(400).send('Invalid amount');
      return;
    }

    const amountUsd = Number(amountRaw);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      res.status(400).send('Invalid amount');
      return;
    }

    if (currency !== 'USD') {
      res.status(400).send('Unsupported currency');
      return;
    }

    const occurredAt = new Date(occurredAtRaw);
    if (Number.isNaN(occurredAt.getTime())) {
      res.status(400).send('Invalid occurred_at');
      return;
    }

    const externalTxId = `adscalex-${eventId}`;

    const existingTx = await prisma.transaction.findUnique({
      where: { externalTransactionId: externalTxId },
      select: { id: true },
    });

    if (existingTx) {
      res.status(200).send('OK');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: publisherUserId },
      select: { id: true },
    });

    if (!user) {
      console.error(`AdScaleX callback: user ${publisherUserId} not found for event ${eventId}`);
      res.status(404).send('Unknown user');
      return;
    }

    // Test deliveries from the dashboard are not credited. They use a zero
    // amount in the documented example; zero-value live credits are harmless too.
    if (amountUsd === 0) {
      console.log(`AdScaleX callback: zero-value event ${eventId} acknowledged without credit`);
      res.status(200).send('OK');
      return;
    }

    const rewardAmount = Math.floor(amountUsd * ADSCALEX_POINTS_PER_USD + Number.EPSILON);
    if (!Number.isSafeInteger(rewardAmount) || rewardAmount <= 0) {
      res.status(400).send('Invalid reward amount');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, publisherUserId);

      const duplicate = await tx.transaction.findUnique({
        where: { externalTransactionId: externalTxId },
        select: { id: true },
      });

      if (duplicate) return;

      await tx.user.update({
        where: { id: publisherUserId },
        data: {
          balance: { increment: rewardAmount },
          totalEarned: { increment: rewardAmount },
        },
      });

      await tx.transaction.create({
        data: {
          userId: publisherUserId,
          amount: rewardAmount,
          type: 'earning',
          status: 'success',
          description: 'Completed AdScaleX offer',
          externalTransactionId: externalTxId,
          createdAt: occurredAt,
        },
      });
    });

    console.log(
      `AdScaleX callback: credited ${rewardAmount} Sikka to ${publisherUserId}` +
      ` event=${eventId}` +
      `${campaignId ? ` campaign=${campaignId}` : ''}` +
      ` amount_usd=${amountRaw}`,
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling AdScaleX callback:', error);
    res.status(500).send('Internal server error');
  }
};
