import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

export const getFaqs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const faqs = await prisma.fAQ.findMany();
    res.status(200).json({ success: true, faqs });
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createTicket = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let userId = req.user?.userId;

    // Extract token optionally if it's there in the headers (in case requireJwt is bypassed)
    const authHeader = req.headers.authorization;
    if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userId = decoded.userId;
      } catch (err) {
        console.log('Optional JWT verification failed in createTicket:', err);
      }
    }

    const { name, mobile, issue } = req.body;

    if (!name || !mobile || !issue) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Try to associate with a user if userId is null but mobile is provided
    let finalUserId: string | null = userId || null;
    if (!finalUserId && mobile) {
      let formattedPhone = mobile.trim();
      if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+91' + formattedPhone;
      }
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { phoneNumber: mobile.trim() },
            { phoneNumber: formattedPhone }
          ]
        }
      });
      if (existingUser) {
        finalUserId = existingUser.id;
      }
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: finalUserId,
        name,
        mobile,
        issue,
      }
    });

    res.status(201).json({ success: true, ticket });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMyTickets = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
