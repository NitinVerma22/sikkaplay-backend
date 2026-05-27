"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyTickets = exports.createTicket = exports.getFaqs = void 0;
const db_1 = require("../config/db");
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
        const userId = req.user?.userId;
        const { name, mobile, issue } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!name || !mobile || !issue) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        const ticket = await db_1.prisma.supportTicket.create({
            data: {
                userId,
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
