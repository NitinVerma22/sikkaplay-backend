import { prisma } from './src/config/db';

async function main() {
  const result = await prisma.user.updateMany({
    where: { isBlocked: true },
    data: { isBlocked: false }
  });
  console.log(`Unblocked ${result.count} users.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
