import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { resolveViewer, renderSiteBBCode } from '../modules/bbcodeRender';
import type { Request } from 'express';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createMember = async (showMatureContent: boolean) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({
    data: { showMatureContent }
  });
  const profile = await testPrisma.profile.create({ data: {} });
  const suffix = `${Date.now()}-${Math.random()}`;
  return testPrisma.user.create({
    data: {
      username: `mature-${suffix}`,
      email: `mature-${suffix}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const reqFor = (userId: number) =>
  ({ user: { id: userId } }) as unknown as Request;

describe('resolveViewer — the [mature] gate against a real settings row (#400)', () => {
  it('reads the stored preference in both directions', async () => {
    const optedIn = await createMember(true);
    const optedOut = await createMember(false);

    expect(await resolveViewer(reqFor(optedIn.id))).toEqual({
      showMature: true
    });
    expect(await resolveViewer(reqFor(optedOut.id))).toEqual({
      showMature: false
    });
  });

  it('defaults an existing row to opted-IN, so the gate ships without a blackout', async () => {
    // The column default is true (#400): stellar-ui has no control yet (ui#311),
    // and defaulting false would hide every [mature] block from everyone with no
    // way to re-enable it.
    const member = await createMember(undefined as unknown as boolean);
    expect(await resolveViewer(reqFor(member.id))).toEqual({
      showMature: true
    });
  });

  it('fails CLOSED for an unauthenticated caller', async () => {
    expect(await resolveViewer({} as Request)).toEqual({ showMature: false });
  });

  // This is the assertion no unit test can make, and the one most likely to
  // regress: someone later moves the resolveViewer call inside the .map() that
  // renders each row. Four render sites loop over a paginated list, so that
  // change would issue one identical settings query per row and nothing else
  // would notice.
  it('costs ONE settings query for a whole page of rows, not one per row', async () => {
    const member = await createMember(false);
    const bodies = Array.from({ length: 25 }, (_, i) => `[b]row ${i}[/b]`);

    const spy = jest.spyOn(prisma.user, 'findUnique');
    try {
      const viewer = await resolveViewer(reqFor(member.id));
      await Promise.all(bodies.map((b) => renderSiteBBCode(b, viewer)));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
