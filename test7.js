const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('./src/utils/crypto.utils');
const prisma = new PrismaClient();

async function test() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, phoneNumber: true, name: true }
    });
    let failed = 0;
    for (const u of users) {
      if (u.phoneNumber) {
        try {
          decrypt(u.phoneNumber);
        } catch (e) {
          failed++;
        }
      }
    }
    console.log(`Failed to decrypt phone numbers for ${failed} out of ${users.length} users`);
  } catch (e) {
    console.error("Prisma error:", e);
  } finally {
    prisma.$disconnect();
  }
}
test();
