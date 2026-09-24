const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findFirst().then(u => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: u.id }, process.env.JWT_SECRET || 'super-secret-sikkaplay-key', { expiresIn: '1d' });
    console.log(token);
}).finally(() => prisma.$disconnect());
