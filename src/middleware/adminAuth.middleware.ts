import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';

export interface AdminAuthRequest extends Request {
  admin?: any;
}

export const requireAdminJwt = (req: AdminAuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Ensure the token belongs to an admin (has adminId)
    const payload = decoded as any;
    if (!payload.adminId) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }
    req.admin = payload;
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
