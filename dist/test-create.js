"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const db_1 = require("./config/db");
async function test() {
    console.log("Starting create test...");
    try {
        console.log("Attempting create...");
        const result = await db_1.prisma.notification.create({
            data: {
                userId: 'eb30b7b1-e0f9-403d-8198-0d063589451c',
                title: 'Test Title Single',
                body: 'Test Body Single',
                type: 'alert',
                bannerUrl: undefined // This is what happens when bannerUrl is missing from req.body
            }
        });
        console.log("create succeeded! Result:", result);
        // Clean up
        await db_1.prisma.notification.deleteMany({
            where: {
                title: 'Test Title Single',
                body: 'Test Body Single'
            }
        });
        console.log("Cleanup succeeded!");
    }
    catch (err) {
        console.error("create failed with error name:", err.name);
        console.error("Error message:", err.message);
    }
    finally {
        await db_1.prisma.$disconnect();
        process.exit(0);
    }
}
test();
