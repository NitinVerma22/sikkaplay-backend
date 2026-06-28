"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./config/db");
async function main() {
    try {
        console.log('Testing Prisma Friendship query...');
        const list = await db_1.prisma.friendship.findMany();
        console.log('Success! Items count:', list.length);
    }
    catch (err) {
        console.error('Error during query:', err);
    }
}
main();
