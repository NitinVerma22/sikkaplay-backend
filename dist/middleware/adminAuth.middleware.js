"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.requireAdminJwt = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const requireAdminJwt = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, ADMIN_JWT_SECRET);
        }
        catch (err) {
            if (process.env.JWT_SECRET && ADMIN_JWT_SECRET !== process.env.JWT_SECRET) {
                decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            }
            else {
                throw err;
            }
        }
        // Ensure the token belongs to an admin (has adminId)
        if (!decoded || !decoded.adminId) {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
            return;
        }
        // Database verification: Ensure admin exists in DB to prevent token forgery
        const adminUser = await db_1.prisma.admin.findUnique({
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
    }
    catch (error) {
        res.status(401).json({ error: 'Unauthorized: Invalid admin session' });
    }
};
exports.requireAdminJwt = requireAdminJwt;
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
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
exports.requireRole = requireRole;
