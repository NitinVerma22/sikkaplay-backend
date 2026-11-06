import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

export interface AdminAuthRequest extends Request {
  admin?: any;
}

export const requireAdminJwt = async (req: AdminAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    let decoded: any;
    try {
      decoded = jwt.verify(token, ADMIN_JWT_SECRET) as any;
    } catch (err) {
      if (process.env.JWT_SECRET && ADMIN_JWT_SECRET !== process.env.JWT_SECRET) {
        decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
      } else {
        throw err;
      }
    }

    // Ensure the token belongs to an admin (has adminId)
    if (!decoded || !decoded.adminId) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    // Database verification: Ensure admin exists in DB to prevent token forgery
    const adminUser = await prisma.admin.findUnique({
      where: { id: decoded.adminId }
    });

    if (!adminUser) {
      res.status(401).json({ error: 'Unauthorized: Admin account not found or deactivated' });
      return;
    }

    req.admin = {
      adminId: adminUser.id,
      username: adminUser.username,
      role: adminUser.role
    };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized: Invalid admin session' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AdminAuthRequest, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Unauthorized: No session found' });
      return;
    }

    const { role } = req.admin;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};
