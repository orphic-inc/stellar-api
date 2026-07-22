import type { PrismaClient, Prisma } from '@prisma/client';

// Everything the renderer needs from the caller. Prisma is injected (not the
// singleton import) so the lib stays decoupled and unit-testable with a mock,
// and a caller can hand in a transaction client. `siteUrl` drives on-site URL
// shortening (#398 Q12). `viewer` is the seam for the future `[mature]` gate
// (#400) — once it exists it also becomes a render-cache-key dimension.
export interface BBCtx {
  db: PrismaClient | Prisma.TransactionClient;
  siteUrl: string;
  viewer?: {
    showMature: boolean;
  };
}
