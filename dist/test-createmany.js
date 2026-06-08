"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const db_1 = require("./config/db");
async function test() {
    console.log("Starting createMany test...");
    try {
        const dbEntries = [
            {
                userId: 'eb30b7b1-e0f9-403d-8198-0d063589451c',
                title: 'Test Title',
                body: 'Test Body',
                type: 'alert',
                bannerUrl: undefined // This is what happens when bannerUrl is missing from req.body
            }
        ];
        // We run it inside a transaction that we rollback, or we just delete it after
        console.log("Attempting createMany...");
        const result = await db_1.prisma.notification.createMany({
            data: dbEntries
        });
        console.log("createMany succeeded! Result:", result);
        // Clean up
        await db_1.prisma.notification.deleteMany({
            where: {
                title: 'Test Title',
                body: 'Test Body'
            }
        });
        console.log("Cleanup succeeded!");
    }
    catch (err) {
        console.error("createMany failed with error name:", err.name);
        console.error("Error message:", err.message);
    }
    finally {
        await db_1.prisma.$disconnect();
        process.exit(0);
    }
}
test();
