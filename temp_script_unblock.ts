import { prisma } from './src/config/db';

async function main() {
  await prisma.dailyCode.deleteMany({
    where: { code: "EXPIREDCODE24" }
  });
  console.log("Cleaned up test daily code.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
