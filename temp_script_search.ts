import { prisma } from './src/config/db';
async function main() {
  const users = await prisma.user.findMany({
    where: { avatarUrl: { contains: 'wikimedia' } }
  });
  console.log('Users with wikimedia avatar:', users.map(u => ({ id: u.id, url: u.avatarUrl })));

  const notifications = await prisma.notification.findMany({
    where: { imageUrl: { contains: 'wikimedia' } }
  });
  console.log('Notifications with wikimedia image:', notifications.map(n => ({ id: n.id, url: n.imageUrl })));

  const gifts = await prisma.gift.findMany({
    where: { imageUrl: { contains: 'wikimedia' } }
  });
  console.log('Gifts with wikimedia image:', gifts.map(g => ({ id: g.id, url: g.imageUrl })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
