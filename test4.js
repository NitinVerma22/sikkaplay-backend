const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const userId = '2b34f3c3-5ff5-4663-a45a-9c66299f9e14'; // user from recent messages
  try {
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userOneId: userId },
          { userTwoId: userId }
        ]
      }
    });
    console.log("Friendships:", friendships.length);
    for (const f of friendships.slice(0, 2)) {
      const friendId = f.userOneId === userId ? f.userTwoId : f.userOneId;
      const ids = [userId, friendId].sort();
      const channelName = `private-chat-${ids[0]}-${ids[1]}`;
      console.log("Checking channel:", channelName);
      
      const hiddenChat = await prisma.hiddenChat.findUnique({
        where: { userId_channelName: { userId, channelName } }
      });
      
      const lastMessage = await prisma.playgroundMessage.findFirst({
        where: {
          channelName,
          ...(hiddenChat ? { createdAt: { gt: hiddenChat.hiddenAt } } : {})
        },
        orderBy: { createdAt: 'desc' }
      });
      console.log("Last message:", lastMessage);
    }
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
