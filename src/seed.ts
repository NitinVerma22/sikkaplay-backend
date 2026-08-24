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
        vpnDetectionEnabled: false,
        vpnApiKey: "",
        maintenanceMode: false,
        refWithdrawMinPlaytimeMins: 3000,
        refWithdrawMinReferrals: 2,
        gullakAdSequence: "interstitial,rewarded,none",
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
        vpnDetectionEnabled: false,
        vpnApiKey: "",
        maintenanceMode: false,
        refWithdrawMinPlaytimeMins: 3000,
        refWithdrawMinReferrals: 2,
        gullakAdSequence: "interstitial,rewarded,none",
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

  // 4. Create default App Offers if none exist
  const existingOffersCount = await prisma.appOffer.count();
  if (existingOffersCount === 0) {
    const defaultOffers = [
      {
        offerId: 'binance',
        title: 'Binance Crypto Exchange',
        description: 'Install and create a verified account to earn coins.',
        size: '85 MB',
        rewardAmount: 350,
        iconName: 'currency_bitcoin',
        iconBg: '#F59E0B',
      },
      {
        offerId: 'phonepe',
        title: 'PhonePe: UPI payments',
        description: 'Install and complete your first UPI transaction.',
        size: '42 MB',
        rewardAmount: 180,
        iconName: 'account_balance',
        iconBg: '#7B1FA2',
      },
      {
        offerId: 'telegram',
        title: 'Telegram Messenger',
        description: 'Download Telegram app and join our official chat.',
        size: '30 MB',
        rewardAmount: 60,
        iconName: 'send_rounded',
        iconBg: '#1E88E5',
      },
      {
        offerId: 'gpay',
        title: 'Google Pay payments',
        description: 'Install and register a new UPI bank account.',
        size: '51 MB',
        rewardAmount: 220,
        iconName: 'payments',
        iconBg: '#00796B',
      },
      {
        offerId: 'whatsapp_biz',
        title: 'WhatsApp Business',
        description: 'Download business messenger and setup profile.',
        size: '38 MB',
        rewardAmount: 80,
        iconName: 'business_center',
        iconBg: '#43A047',
      },
    ];

    for (const o of defaultOffers) {
      await prisma.appOffer.create({ data: o });
    }
    console.log('Default app install offers seeded');
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
