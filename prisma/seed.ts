import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.userRank.findFirst({ where: { level: 100 } });
  if (!existing) {
    await prisma.userRank.create({
      data: { level: 100, name: 'User', permissions: {} }
    });
    console.log('Created default UserRank (level 100)');
  } else {
    console.log('Default UserRank (level 100) already exists');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
