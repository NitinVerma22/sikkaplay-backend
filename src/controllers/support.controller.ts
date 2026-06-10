import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../config/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

export const getFaqs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let faqs = await prisma.fAQ.findMany();

    if (faqs.length === 0) {
      const defaultFaqs = [
        {
          question: "What is SikkaPlay?",
          answer: "SikkaPlay is a premium reward-based gaming platform where you can play games, complete simple daily tasks, scroll through Reels, and refer friends to earn Sikka coins. These coins can be withdrawn directly via UPI."
        },
        {
          question: "How do I earn Sikka coins?",
          answer: "There are multiple ways to earn Sikka coins:\n1. Watch Reels: Earn coins continuously for scrolling Reels.\n2. Play Games: Play Emoji Memory, Math Rush, Treasure Grid, or Lucky Spin Wheel.\n3. Daily Code: Claim daily promo codes for bonus Sikka.\n4. Tasks & Surveys: Visit sponsored websites or complete partner surveys.\n5. Social Tasks: Join our official Telegram and WhatsApp channels."
        },
        {
          question: "How can I withdraw my coins and what is the minimum limit?",
          answer: "Go to the Wallet section, enter your UPI ID, and request a withdrawal. The minimum withdrawal limit is 1,000 Sikka coins (100 Sikka = 1 INR)."
        },
        {
          question: "What is the Referral/Network Earning program?",
          answer: "When you refer a friend, you earn 500 Sikka instantly. You also earn a 10% commission on all withdrawals made by your direct and indirect network members (up to Level 3)!"
        },
        {
          question: "What are the rules of Emoji Memory?",
          answer: "At the start of the round, the board flips open for a 5-second preview. Memorize the card positions. Then, guess cards that match the target emoji shown in the bubble. Correct guess: +3 Sikka. You have up to 3 strikes per round."
        },
        {
          question: "What are the rules of Math Rush?",
          answer: "Solve equations within the time limit. You can choose from four modes:\n- Default: Progressive difficulty, 10s timer, +2 Sikka per correct answer.\n- Easy: Static easy questions, 10s timer, +1 Sikka.\n- Medium: Static medium questions, 8s timer, +2 Sikka.\n- Hard: Static hard questions, 6s timer, +3 Sikka."
        },
        {
          question: "What are the rules of Treasure Grid?",
          answer: "Select 3 card positions on the grid. If they match the treasure, you win coins. If you choose not to watch a video ad to claim, a bypass fee is deducted from your winnings. If you strike out, the round resets."
        },
        {
          question: "What are the rules of Lucky Spin Wheel?",
          answer: "Every day you get 3 free spins. Spin the wheel to win rewards ranging from 1 to 30 Sikka. If you run out of spins, you can watch a rewarded video ad to get 3 more spins. Spins are 100% free!"
        }
      ];

      await prisma.fAQ.createMany({
        data: defaultFaqs
      });

      faqs = await prisma.fAQ.findMany();
    }

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
