"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVisitLink = exports.createVisitLink = exports.getVisitLinks = void 0;
const db_1 = require("../config/db");
// --- GET ALL LINKS (USER & ADMIN) ---
const getVisitLinks = async (req, res) => {
    try {
        const links = await db_1.prisma.visitEarnLink.findMany({
            orderBy: { createdAt: 'asc' },
        });
        res.status(200).json({
            success: true,
            links,
        });
    }
    catch (error) {
        console.error('Error fetching visit links:', error);
        res.status(500).json({ error: 'Internal server error while fetching visit links' });
    }
};
exports.getVisitLinks = getVisitLinks;
// --- CREATE LINK (ADMIN ONLY) ---
const createVisitLink = async (req, res) => {
    try {
        const { title, url, rewardAmount } = req.body;
        if (!title || typeof title !== 'string') {
            res.status(400).json({ error: 'Title is required and must be a string' });
            return;
        }
        if (!url || typeof url !== 'string') {
            res.status(400).json({ error: 'URL is required and must be a string' });
            return;
        }
        const coinsReward = typeof rewardAmount === 'number' ? rewardAmount : parseInt(rewardAmount) || 5;
        if (coinsReward <= 0) {
            res.status(400).json({ error: 'Coins reward must be greater than 0' });
            return;
        }
        const newLink = await db_1.prisma.visitEarnLink.create({
            data: {
                title: title.trim(),
                url: url.trim(),
                rewardAmount: coinsReward,
            },
        });
        res.status(200).json({
            success: true,
            message: 'Visit link created successfully',
            link: newLink,
        });
    }
    catch (error) {
        console.error('Error creating visit link:', error);
        res.status(500).json({ error: 'Internal server error while creating visit link' });
    }
};
exports.createVisitLink = createVisitLink;
// --- DELETE LINK (ADMIN ONLY) ---
const deleteVisitLink = async (req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            res.status(400).json({ error: 'Link ID is required' });
            return;
        }
        const existingLink = await db_1.prisma.visitEarnLink.findUnique({
            where: { id },
        });
        if (!existingLink) {
            res.status(404).json({ error: 'Visit link not found' });
            return;
        }
        await db_1.prisma.visitEarnLink.delete({
            where: { id },
        });
        res.status(200).json({
            success: true,
            message: 'Visit link deleted successfully',
        });
    }
    catch (error) {
        console.error('Error deleting visit link:', error);
        res.status(500).json({ error: 'Internal server error while deleting visit link' });
    }
};
exports.deleteVisitLink = deleteVisitLink;
