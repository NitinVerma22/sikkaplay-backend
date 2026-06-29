"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireJwt = exports.verifyToken = exports.onlineUsersCache = void 0;
const firebase_1 = require("../config/firebase");
const db_1 = require("../config/db");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_cache_1 = __importDefault(require("node-cache"));
exports.onlineUsersCache = new node_cache_1.default({ stdTTL: 15 });
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await firebase_1.auth.verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    }
    catch (error) {
        console.error('Error verifying Firebase token:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
exports.verifyToken = verifyToken;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const requireJwt = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded; // Contains userId
        exports.onlineUsersCache.set(decoded.userId, true);
        // Dynamic anti-fraud/suspension check
        const user = await db_1.prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { isBlocked: true }
        });
        if (!user) {
            res.status(401).json({ error: 'Unauthorized: User account does not exist.' });
            return;
        }
        if (user.isBlocked) {
            res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact support.' });
            return;
        }
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }
};
exports.requireJwt = requireJwt;
