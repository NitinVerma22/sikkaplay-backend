import { Request, Response } from 'express';
import { prisma } from '../config/db';
import crypto from 'crypto';

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
      // Calculate MD5 hash: md5(trans_id + "-" + user_id + "-" + amount_local + "-" + secure_key)
      const dataToHash = `${trans_id}-${user_id}-${amount_local}-${secureKey}`;
      const calculatedHash = crypto.createHash('md5').update(dataToHash).digest('hex');

      if (calculatedHash !== hash) {
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

    // Check if transaction already exists (avoid double claiming)
    const existingTx = await prisma.transaction.findFirst({
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
        },
      });
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling CPX callback:', error);
    res.status(500).send('Internal server error');
  }
};
