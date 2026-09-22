/**
 * `updateProfile`'s settings writer — the five privacy flags reach the row
 * (#586, ADR-0046).
 *
 * WHY THIS FILE EXISTS. The route-level specs mock `modules/profile` wholesale
 * via `apiTestHarness`, so they assert what the ROUTE forwards and can see
 * nothing about what the writer does with it. That left the `userSettings.update`
 * spread block untested: a negative control deleting `showRatioStats` from it
 * broke no test at all.
 *
 * That block is exactly what #586 edited — it used to end with
 * `...paranoiaToVisibility(data.paranoia)`, which sat LAST and overwrote every
 * explicitly-sent flag. The guarantee this change exists to make is that a
 * ticked checkbox reaches the database, so it needs a test at the layer that
 * decides it.
 */

const mockPrisma = {
  user: { findUnique: jest.fn() },
  authorStylesheet: { findUnique: jest.fn() },
  profile: { update: jest.fn() },
  userSettings: { update: jest.fn() },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

// Keep isomorphic-dompurify (jsdom ESM) out of the jest graph — it pulls in
// transitively through profile.ts. Same shape as profileBBCode.spec.ts.
jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

import { updateProfile } from './profile';

const bbViewer = { showMature: true } as never;

const settingsUpdateArg = () => {
  // $transaction receives the array of operations; the settings update is the
  // one addressed by userSettingsId.
  const calls = mockPrisma.userSettings.update.mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0].data;
};

beforeEach(() => {
  jest.clearAllMocks();
  // updateProfile self-reads via getProfileById on the way out; the second
  // lookup returning null short-circuits that read, which we do not test here.
  mockPrisma.user.findUnique.mockResolvedValueOnce({
    profileId: 10,
    userSettingsId: 20
  });
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe('updateProfile — the five privacy flags', () => {
  it('writes every flag it is given, including the false ones', async () => {
    // `false` is the meaningful value here — a spread keyed on `!== undefined`
    // is what makes hiding something possible at all. A truthiness check would
    // silently drop every "hide this" and read as working.
    await updateProfile(
      1,
      {
        showEmail: false,
        showLastSeen: false,
        showContributedStats: false,
        showConsumedStats: false,
        showRatioStats: false
      },
      bbViewer
    );

    expect(settingsUpdateArg()).toEqual({
      showEmail: false,
      showLastSeen: false,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    });
  });

  it('writes a single flag without disturbing the other four', async () => {
    await updateProfile(1, { showRatioStats: true }, bbViewer);

    expect(settingsUpdateArg()).toEqual({ showRatioStats: true });
  });

  it('never writes a paranoia key, whatever it is handed (#586)', async () => {
    // The cascade used to synthesise `paranoia` plus all five here. Nothing in
    // the writer may reintroduce a key the column no longer has — a stray one
    // would be a Prisma unknown-argument error at runtime, on a live settings
    // save, which no route test would catch.
    await updateProfile(1, { showEmail: true, paranoia: 3 } as never, bbViewer);

    expect(settingsUpdateArg()).not.toHaveProperty('paranoia');
    expect(settingsUpdateArg()).toEqual({ showEmail: true });
  });

  it('leaves the flags alone entirely when none is sent', async () => {
    await updateProfile(1, { siteAppearance: 'dark' }, bbViewer);

    expect(settingsUpdateArg()).toEqual({ siteAppearance: 'dark' });
  });
});
