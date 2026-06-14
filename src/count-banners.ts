import 'dotenv/config';
import { prisma } from './config/db';

async function main() {
  const allImpressions = await prisma.adImpression.findMany();
  console.log('Total ad impressions in DB:', allImpressions.length);
  
  const banners = allImpressions.filter(i => i.adType.includes('banner'));
  console.log('Banner impressions:', banners.length);
  console.log('Sample banners:', banners.slice(0, 5));
  
  const rewardeds = allImpressions.filter(i => i.adType.includes('rewarded'));
  console.log('Rewarded impressions:', rewardeds.length);
  
  const interstitials = allImpressions.filter(i => i.adType.includes('interstitial'));
  console.log('Interstitial impressions:', interstitials.length);
}

main().catch(console.error);
