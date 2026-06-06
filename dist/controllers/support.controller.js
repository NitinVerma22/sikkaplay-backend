"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyTickets = exports.createTicket = exports.getFaqs = void 0;
const db_1 = require("../config/db");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const getFaqs = async (req, res) => {
    try {
        const faqs = await db_1.prisma.fAQ.findMany();
        res.status(200).json({ success: true, faqs });
    }
    catch (error) {
        console.error('Error fetching FAQs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getFaqs = getFaqs;
const createTicket = async (req, res) => {
    try {
        let userId = req.user?.userId;
        // Extract token optionally if it's there in the headers (in case requireJwt is bypassed)
        const authHeader = req.headers.authorization;
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            try {
                const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
                userId = decoded.userId;
            }
            catch (err) {
                console.log('Optional JWT verification failed in createTicket:', err);
            }
        }
        const { name, mobile, issue } = req.body;
        if (!name || !mobile || !issue) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        // Try to associate with a user if userId is null but mobile is provided
        let finalUserId = userId || null;
        if (!finalUserId && mobile) {
            let formattedPhone = mobile.trim();
            if (!formattedPhone.startsWith('+')) {
                formattedPhone = '+91' + formattedPhone;
            }
            const existingUser = await db_1.prisma.user.findFirst({
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
        const ticket = await db_1.prisma.supportTicket.create({
            data: {
                userId: finalUserId,
                name,
                mobile,
                issue,
            }
        });
        res.status(201).json({ success: true, ticket });
    }
    catch (error) {
        console.error('Error creating ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.createTicket = createTicket;
const getMyTickets = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const tickets = await db_1.prisma.supportTicket.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, tickets });
    }
    catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getMyTickets = getMyTickets;
