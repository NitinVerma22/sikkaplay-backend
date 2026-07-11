import { prisma } from './config/db';

const gifts = [
  { name: 'Coffee', coinsPrice: 50, imageUrl: '☕' },
  { name: 'Heart', coinsPrice: 50, imageUrl: '💖' },
  { name: 'Ice Cream', coinsPrice: 100, imageUrl: '🍦' },
  { name: 'Bouquet', coinsPrice: 100, imageUrl: '💐' },
  { name: 'Rose', coinsPrice: 200, imageUrl: '🌹' },
  { name: 'Watch', coinsPrice: 200, imageUrl: '⌚' },
  { name: 'Chocolate', coinsPrice: 500, imageUrl: '🍫' },
  { name: 'Female Shoes', coinsPrice: 500, imageUrl: '👠' },
  { name: 'Boys Shoes', coinsPrice: 500, imageUrl: '👞' },
  { name: 'Crown', coinsPrice: 1000, imageUrl: '👑' },
  { name: 'Female Bag', coinsPrice: 1000, imageUrl: '👜' },
  { name: 'Ring', coinsPrice: 2000, imageUrl: '💍' },
  { name: 'Dress', coinsPrice: 2000, imageUrl: '👗' },
  { name: 'Coat Pant', coinsPrice: 2000, imageUrl: '👔' },
  { name: 'Jewelry', coinsPrice: 2000, imageUrl: '💎' },
  { name: 'Female Jackpot', coinsPrice: 5000, imageUrl: '🎊🎁🎊' },
  { name: 'Boys Kit', coinsPrice: 5000, imageUrl: '🏏' },
];

async function seedGifts() {
  for (const g of gifts) {
    const existing = await prisma.gift.findFirst({ where: { name: g.name } });
    if (!existing) {
      await prisma.gift.create({ data: g });
      console.log(`Created gift: ${g.name}`);
    } else {
      console.log(`Gift already exists: ${g.name}`);
    }
  }
  console.log('Gifts seeded');
}

seedGifts().then(() => prisma.$disconnect());
