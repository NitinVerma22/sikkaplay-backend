import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { prisma } from '../config/db';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: any;
}

export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

export const requireJwt = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded; // Contains userId

    // Dynamic anti-fraud/suspension check
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { isBlocked: true }
    });

    if (user?.isBlocked) {
      res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact support.' });
      return;
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized: Invalid session' });
  }
};
