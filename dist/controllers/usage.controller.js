"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logUsage = void 0;
const db_1 = require("../config/db");
const date_utils_1 = require("../utils/date.utils");
/**
 * Frontend pings this every 5 minutes (while app is open and active)
 * Body: { minutes: 5 }
 */
const logUsage = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { minutes, type } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (!minutes || typeof minutes !== 'number') {
            res.status(400).json({ error: 'Invalid minutes' });
            return;
        }
        const todayStr = (0, date_utils_1.getISTDateString)();
        const updateData = type === 'games' ? { gamesMinutes: { increment: minutes } } : { reelsMinutes: { increment: minutes } };
        const createData = type === 'games' ? { gamesMinutes: minutes } : { reelsMinutes: minutes };
        // Upsert the daily usage record
        const usage = await db_1.prisma.dailyUsage.upsert({
            where: {
                userId_dateStr: {
                    userId,
                    dateStr: todayStr,
                }
            },
            update: updateData,
            create: {
                userId,
                dateStr: todayStr,
                ...createData,
            }
        });
        res.status(200).json({ success: true, todayMinutes: type === 'games' ? usage.gamesMinutes : usage.reelsMinutes });
    }
    catch (error) {
        console.error('Error logging usage:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.logUsage = logUsage;
