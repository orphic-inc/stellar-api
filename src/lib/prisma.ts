import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // A pending leadership offer is shown to its parties only (ADR-0053 §8), and
    // community responses spread the whole row. Omitting the columns here keeps
    // every read, nested ones included, from carrying it; the leadership module
    // selects them by name (modules/communityLeadership.ts, #896).
    omit: { community: { leaderOfferToId: true, leaderOfferedAt: true } },
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'info', 'warn', 'error']
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
