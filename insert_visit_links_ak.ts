import { prisma } from './src/config/db';

const links = [
  "https://reward-task-08.vercel.app/",
  "https://reward-task-07.vercel.app/",
  "https://reward-task-06.vercel.app/",
  "https://reward-task-05.vercel.app/",
  "https://reward-task-04.vercel.app/",
  "https://reward-task-003.vercel.app/",
  "https://reward-task-03.vercel.app/",
  "https://reward-task.vercel.app/"
];

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  // Purane links delete nahi kar rahe!
  let taskCounter = 1;

  for (const url of links) {
    // First occurrence
    let timer1 = getRandomInt(25, 30);
    let reward1 = getRandomInt(7, 10);
    
    let title1 = `AK- Visit and Earn _${taskCounter.toString().padStart(2, '0')}`;
    
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

    let title2 = `AK- Visit and Earn _${taskCounter.toString().padStart(2, '0')}`;
    
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
  
  console.log('Successfully inserted ' + (taskCounter - 1) + ' new tasks!');
}

main()
  .catch(e => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
