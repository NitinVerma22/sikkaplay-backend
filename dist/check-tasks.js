"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./config/db");
const date_utils_1 = require("./utils/date.utils");
async function main() {
    console.log('--- DATABASE DIAGNOSTICS ---');
    const totalLinks = await db_1.prisma.visitEarnLink.count();
    console.log('Total VisitEarnLinks in database:', totalLinks);
    const links = await db_1.prisma.visitEarnLink.findMany();
    console.log('Links list:', links.map(l => ({ id: l.id, title: l.title, reward: l.rewardAmount })));
    const startOfToday = (0, date_utils_1.getStartOfTodayIST)();
    console.log('Start of Today IST (in UTC):', startOfToday.toISOString());
    // Find all claims
    const totalClaims = await db_1.prisma.visitEarnClaim.count();
    console.log('Total VisitEarnClaims in database:', totalClaims);
    const claims = await db_1.prisma.visitEarnClaim.findMany({
        orderBy: { claimedAt: 'desc' },
        take: 10
    });
    console.log('Last 10 claims:', claims);
    // Find all users
    const users = await db_1.prisma.user.findMany({
        select: { id: true, name: true, phoneNumber: true, balance: true }
    });
    console.log('Users in database:', users);
    for (const user of users) {
        console.log(`\nEvaluating tasks for user: ${user.name || user.phoneNumber} (${user.id})`);
        const visitedClaimsToday = await db_1.prisma.visitEarnClaim.findMany({
            where: {
                userId: user.id,
                claimedAt: { gte: startOfToday }
            }
        });
        console.log('Visited claims today:', visitedClaimsToday.length, visitedClaimsToday);
        const uniqueVisited = new Set(visitedClaimsToday.map(c => c.linkId));
        console.log('Unique visited links count today:', uniqueVisited.size);
        console.log('Task Completed status:', totalLinks > 0 && uniqueVisited.size >= totalLinks);
        const todaysTransactions = await db_1.prisma.transaction.findMany({
            where: { userId: user.id, createdAt: { gte: startOfToday } }
        });
        console.log('Transactions today:', todaysTransactions.map(t => ({ desc: t.description, amount: t.amount, type: t.type })));
        const claimTx = todaysTransactions.find(t => t.description === 'Daily Task: Visited All Links');
        console.log('Has claimed Visit All Links reward:', !!claimTx);
    }
}
main()
    .catch(err => console.error(err))
    .finally(() => db_1.prisma.$disconnect());
