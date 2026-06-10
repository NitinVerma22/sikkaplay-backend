import { prisma } from './config/db';
import { getMyNetwork } from './controllers/network.controller';

async function main() {
  // Find a user who referred someone
  const referredUser = await prisma.user.findFirst({
    where: {
      referredBy: { not: null }
    },
    select: { referredBy: true }
  });

  let userId: string | null = null;
  let testUser: any = null;

  if (referredUser && referredUser.referredBy) {
    testUser = await prisma.user.findUnique({
      where: { referralCode: referredUser.referredBy },
      select: { id: true, name: true, referralCode: true }
    });
    if (testUser) {
      userId = testUser.id;
    }
  }

  // Fallback to first user if no referred users exist
  if (!userId) {
    testUser = await prisma.user.findFirst({
      select: { id: true, name: true, referralCode: true }
    });
    if (testUser) {
      userId = testUser.id;
    }
  }

  if (!userId) {
    console.log("No users found in database to test with!");
    return;
  }

  console.log(`Testing getMyNetwork controller for user ID: ${userId} (${testUser?.name}, code: ${testUser?.referralCode})`);

  // Mock Request & Response
  const req = {
    user: { userId }
  } as any;

  const res = {
    status(code: number) {
      console.log("Response status code:", code);
      return this;
    },
    json(data: any) {
      console.log("Response JSON data:", JSON.stringify(data, null, 2));
      return this;
    }
  } as any;

  try {
    await getMyNetwork(req, res);
  } catch (error) {
    console.error("Controller threw error:", error);
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());

