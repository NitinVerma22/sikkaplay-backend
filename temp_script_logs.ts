import { prisma } from './src/config/db';

async function main() {
  const logs = await prisma.adminAuditLog.findMany({
    where: { action: 'AUTO_FREEZE_USER' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  
  for (const log of logs) {
    console.log(`Time: ${log.createdAt}`);
    console.log(`Details:`, log.details);
    console.log('-------------------------');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
