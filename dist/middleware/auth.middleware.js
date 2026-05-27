"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireJwt = exports.verifyToken = void 0;
const firebase_1 = require("../config/firebase");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
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
const requireJwt = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded; // Contains userId
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }
};
exports.requireJwt = requireJwt;
