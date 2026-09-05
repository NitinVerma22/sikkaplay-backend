import { prisma } from './src/config/db';

async function updateVersion() {
  try {
    let config = await prisma.appConfig.findFirst();
    if (config) {
      await prisma.appConfig.update({
        where: { id: config.id },
        data: { latestAppVersion: '1.0.13' }
      });
      console.log('Successfully updated latestAppVersion to 1.0.13 in database.');
    } else {
      console.log('No AppConfig found in DB. Creating one...');
      await prisma.appConfig.create({
        data: { latestAppVersion: '1.0.13' }
      });
      console.log('Successfully created AppConfig with latestAppVersion 1.0.13.');
    }
  } catch (error) {
    console.error('Error updating DB:', error);
  } finally {
    process.exit(0);
  }
}

updateVersion();
