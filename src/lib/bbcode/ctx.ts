import type { PrismaClient, Prisma } from '@prisma/client';

// Everything the renderer needs from the caller. Prisma is injected (not the
// singleton import) so the lib stays decoupled and unit-testable with a mock,
// and a caller can hand in a transaction client. `siteUrl` drives on-site URL
// shortening (#398 Q12).
//
// `viewer` is REQUIRED, and deliberately so (#400). Rendering is viewer-dependent
// once `[mature]` gates on a setting, and an optional field would let a call site
// forget to thread it and silently fall back to the ungated render -- a gate that
// no-ops is indistinguishable from no gate, which is the failure this codebase has
// shipped five times. Making it required turns every un-threaded call site into a
// compile error instead, caught by the pre-commit `tsc --noEmit`.
export interface BBCtx {
  db: PrismaClient | Prisma.TransactionClient;
  siteUrl: string;
  viewer: {
    showMature: boolean;
  };
}
