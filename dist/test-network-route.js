"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./config/db");
const network_controller_1 = require("./controllers/network.controller");
async function main() {
    // Find a user who referred someone
    const referredUser = await db_1.prisma.user.findFirst({
        where: {
            referredBy: { not: null }
        },
        select: { referredBy: true }
    });
    let userId = null;
    let testUser = null;
    if (referredUser && referredUser.referredBy) {
        testUser = await db_1.prisma.user.findUnique({
            where: { referralCode: referredUser.referredBy },
            select: { id: true, name: true, referralCode: true }
        });
        if (testUser) {
            userId = testUser.id;
        }
    }
    // Fallback to first user if no referred users exist
    if (!userId) {
        testUser = await db_1.prisma.user.findFirst({
            select: { id: true, name: true, referralCode: true }
        });
        if (testUser) {
            userId = testUser.id;
        }
    }
    if (!userId) {
        console.log("No users found in database to test with!");
        return;
    }
    console.log(`Testing getMyNetwork controller for user ID: ${userId} (${testUser?.name}, code: ${testUser?.referralCode})`);
    // Mock Request & Response
    const req = {
        user: { userId }
    };
    const res = {
        status(code) {
            console.log("Response status code:", code);
            return this;
        },
        json(data) {
            console.log("Response JSON data:", JSON.stringify(data, null, 2));
            return this;
        }
    };
    try {
        await (0, network_controller_1.getMyNetwork)(req, res);
    }
    catch (error) {
        console.error("Controller threw error:", error);
    }
}
main()
    .catch(err => console.error(err))
    .finally(() => db_1.prisma.$disconnect());
