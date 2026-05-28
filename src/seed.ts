import { prisma } from './config/db';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding database...');

  // 1. Create Default Admin if it doesn't exist
  const existingAdmin = await prisma.admin.findUnique({
    where: { username: 'admin' }
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.admin.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        role: 'superadmin'
      }
    });
    console.log('Default admin created: username: admin / password: admin123');
  } else {
    console.log('Admin user already exists');
  }

  // 2. Create Default AppConfig if it doesn't exist
  const existingConfig = await prisma.appConfig.findFirst();

  if (!existingConfig) {
    await prisma.appConfig.create({
      data: {
        gullakMaxSize: 100,
        reelsCoinsPerMin: 5,
        dailyStreakCoins: 50,
        referralBonus: 500,
        commissionRate: 0.10,
        minWithdrawalLimit: 1000,
        apkDownloadUrl: 'https://sikkaplay-apk.web.app/app-release.apk',
        latestAppVersion: '1.0.0',
        forceUpdate: false,
      }
    });
    console.log('Default AppConfig created');
  } else {
    console.log('AppConfig already exists');
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
