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
        telegramLink: 'https://t.me/sikkaplay',
        whatsappLink: 'https://whatsapp.com/channel/sikkaplay',
        groupLink: 'https://t.me/sikkaplay_group',
        watchM1Mins: 20,
        watchM1Coins: 50,
        watchM2Mins: 60,
        watchM2Coins: 200,
        watchM3Mins: 180,
        watchM3Coins: 600,
        playM1Mins: 20,
        playM1Coins: 40,
        playM2Mins: 50,
        playM2Coins: 90,
        playM3Mins: 99,
        playM3Coins: 180,
        dailyCodeTaskCoins: 10,
        visitAllTaskCoins: 30,
        adsEnabled: true,
        allowMultiAccounts: false,
        rewardedCapPerDay: 15,
        dailyCodeAdRequired: true,
        surveysAdRequired: true,
        reelsAdInterval: 5,
      }
    });
    console.log('Default AppConfig created');
  } else {
    console.log('AppConfig already exists, updating missing columns...');
    await prisma.appConfig.updateMany({
      data: {
        watchM1Mins: 20,
        watchM1Coins: 50,
        watchM2Mins: 60,
        watchM2Coins: 200,
        watchM3Mins: 180,
        watchM3Coins: 600,
        playM1Mins: 20,
        playM1Coins: 40,
        playM2Mins: 50,
        playM2Coins: 90,
        playM3Mins: 99,
        playM3Coins: 180,
        dailyCodeTaskCoins: 10,
        visitAllTaskCoins: 30,
        adsEnabled: true,
        allowMultiAccounts: false,
        rewardedCapPerDay: 15,
        dailyCodeAdRequired: true,
        surveysAdRequired: true,
        reelsAdInterval: 5,
        telegramLink: 'https://t.me/sikkaplay',
        whatsappLink: 'https://whatsapp.com/channel/sikkaplay',
        groupLink: 'https://t.me/sikkaplay_group',
      }
    });
  }

  // 3. Create default Visit & Earn links if none exist
  const existingLinksCount = await prisma.visitEarnLink.count();
  if (existingLinksCount === 0) {
    await prisma.visitEarnLink.create({
      data: {
        title: 'Sponsored Reward Task',
        url: 'https://www.effectivecpmnetwork.com/e4bhz80xs?key=bd91f9fc65d8826b9c2d7f8bbeeb640f',
        rewardAmount: 10
      }
    });
    console.log('Default sponsored visit link seeded');
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
