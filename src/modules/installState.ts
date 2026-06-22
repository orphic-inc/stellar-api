import { z } from 'zod';
import { prisma } from '../lib/prisma';

/**
 * Install state is a recorded fact, not an inference. The single stored truth is
 * `SiteSettings.installedAt` (stamped once by POST /install). Everything here is
 * a *derived representation* of that one column — the `phase` is computed at read
 * time and never persisted, which is what keeps the legacy "two facts disagree"
 * failure mode from returning.
 */
export const InstallState = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('awaiting_setup') }),
  z.object({ phase: z.literal('installed'), installedAt: z.coerce.date() })
]);
export type InstallState = z.infer<typeof InstallState>;

/** Pure barrier decision — exhaustive over the union, no I/O. */
export const gate = (state: InstallState): 'pass' | 'block' =>
  state.phase === 'installed' ? 'pass' : 'block';

// Cache only the positive: install is irreversible in normal operation, so once
// installed we latch and skip the DB. The negative is never cached — pre-install
// is a transient setup window where each check must re-read until the stamp lands
// (this is also why no explicit invalidation is needed when POST /install stamps).
let cached: InstallState | null = null;

export const getInstallState = async (): Promise<InstallState> => {
  if (cached?.phase === 'installed') return cached;

  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  // Env-override seam: a future STELLAR_ASSUME_INSTALLED would resolve here,
  // derived at read time — never stored alongside installedAt.
  const state = InstallState.parse(
    settings?.installedAt
      ? { phase: 'installed', installedAt: settings.installedAt }
      : { phase: 'awaiting_setup' }
  );

  if (state.phase === 'installed') cached = state;
  return state;
};

/** Boolean convenience for the route barrier; keeps the mock surface small. */
export const isInstalled = async (): Promise<boolean> =>
  gate(await getInstallState()) === 'pass';

/** Test-only: drop the latched positive so a fresh DB state can be observed. */
export const __resetInstallStateCache = (): void => {
  cached = null;
};
