"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminJwt = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const requireAdminJwt = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Ensure the token belongs to an admin (has adminId)
        const payload = decoded;
        if (!payload.adminId) {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
            return;
        }
        req.admin = payload;
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Unauthorized: Invalid admin session' });
    }
};
exports.requireAdminJwt = requireAdminJwt;
