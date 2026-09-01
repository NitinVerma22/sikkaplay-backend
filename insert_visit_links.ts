import { prisma } from './src/config/db';

const links = [
  "https://rewards-add-marketing.sudarshantechnologies.com/",
  "https://rewards-add-marketing.sudarshantechnologies.com/earning-apps.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/games.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/Money.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/offers.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/sikka.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/cashback.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/gift-cards.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/tips.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/reviews.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/blog.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/blog-post.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/about.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/contact.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/faq.html",
  "https://rewards-add-marketing.sudarshantechnologies.com/privacy-policy.html"
];

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  // Clearing existing tasks
  await prisma.visitEarnLink.deleteMany(); 
  let taskCounter = 1;

  for (const url of links) {
    // First occurrence
    let timer1 = getRandomInt(25, 30);
    let reward1 = getRandomInt(7, 10);
    
    let title1 = `Sk- Visit and Earn _${taskCounter.toString().padStart(2, '0')}`;
    
    await prisma.visitEarnLink.create({
      data: {
        title: title1,
        url: url,
        timerSeconds: timer1,
        rewardAmount: reward1
      }
    });
    taskCounter++;

    // Second occurrence
    let timer2 = getRandomInt(12, 18);
    let reward2 = getRandomInt(4, 5);

    let title2 = `Sk- Visit and Earn _${taskCounter.toString().padStart(2, '0')}`;
    
    await prisma.visitEarnLink.create({
      data: {
        title: title2,
        url: url,
        timerSeconds: timer2,
        rewardAmount: reward2
      }
    });
    taskCounter++;
  }
  
  console.log('Successfully inserted ' + (taskCounter - 1) + ' tasks!');
}

main()
  .catch(e => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
