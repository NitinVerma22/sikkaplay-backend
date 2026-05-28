"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppConfig = void 0;
const db_1 = require("../config/db");
const getAppConfig = async (req, res) => {
    try {
        let config = await db_1.prisma.appConfig.findFirst();
        if (!config) {
            config = await db_1.prisma.appConfig.create({
                data: {}
            });
        }
        res.status(200).json({
            success: true,
            data: {
                ...config,
                latestVersion: config.latestAppVersion,
                updateUrl: config.apkDownloadUrl,
            }
        });
    }
    catch (error) {
        console.error('Error fetching app config:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch config' });
    }
};
exports.getAppConfig = getAppConfig;
