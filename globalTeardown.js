// @ts-check
const { PrismaClient } = require('@prisma/client');

module.exports = async function globalTeardown() {
  const testUrl = process.env.STELLAR_PSQL_URI_TEST;
  if (!testUrl) return;
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  await prisma.$disconnect();
};
