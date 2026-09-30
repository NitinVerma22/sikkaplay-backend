import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.appConfig.findFirst().then(console.log).finally(() => prisma.$disconnect());
