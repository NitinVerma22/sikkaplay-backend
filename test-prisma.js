require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const res = await prisma.playgroundMessage.findMany({
      include: {
        sender: true
      }
    });
    console.log("SUCCESS:", res.length);
  } catch (e) {
    console.error("ERROR:", e);
  }
}
test();
