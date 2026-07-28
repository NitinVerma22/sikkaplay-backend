import { prisma } from './src/config/db';
async function main() {
  const total = await prisma.user.count();
  const deleted = await prisma.user.count({ where: { name: 'Deleted User' } });
  const blocked = await prisma.user.count({ where: { isBlocked: true, NOT: { name: 'Deleted User' } } });
  const active = await prisma.user.count({ where: { isBlocked: false, NOT: { name: 'Deleted User' } } });

  console.log({ total, deleted, blocked, active });
}
main().catch(console.error).finally(() => prisma.$disconnect());
