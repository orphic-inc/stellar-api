/**
 * Every write of an image field registers its remote URL first (#737 slice 3,
 * ADR-0051), so a write past the member's daily ceiling is refused with 429 and
 * writes nothing. The BBCode surfaces are `remoteImageWrites.spec.ts`.
 *
 * Each case runs the real `registerRemoteImages` against the Prisma mock, set
 * at the ceiling, with the remote URL only in the image field. A surface that
 * stops registering its field answers its normal status instead.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions,
  updateProfileMock,
  updateUserSettingsMock
} from './test/apiTestHarness';
import { imageImport } from './modules/config';
import { AppError } from './lib/errors';

jest.mock('./modules/releaseWorkbench/authority', () => ({
  loadReleaseWorkbenchAuthority: async () => ({
    canEditMetadata: true,
    canRevertHistory: true
  })
}));

const donor: typeof import('./modules/donor') =
  jest.requireActual('./modules/donor');
const contribution: typeof import('./modules/contribution') =
  jest.requireActual('./modules/contribution');
import { createCommunityRelease } from './modules/releaseLifecycle';
import { updateReleaseWorkbenchMetadata } from './modules/releaseWorkbench/metadata';
import { revertReleaseWorkbenchHistory } from './modules/releaseWorkbench/history';
import { addGroupCover } from './modules/releaseGroupCovers';

const IMG = 'https://images.example/field.png';
const REF = { actorId: 7, communityId: 1, releaseId: 3 } as never;
const RELEASE = {
  id: 3,
  communityId: 1,
  title: 'Release',
  description: 'plain description',
  image: null,
  year: 2020,
  releaseTags: []
};

const rankWith = (perms: Record<string, boolean>) => {
  prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank(perms));
  setCurrentUserPermissions(
    makeUserRank(perms).permissions as Record<string, boolean>
  );
};

interface RouteCase {
  name: string;
  send: () => ReturnType<ReturnType<typeof request>['post']>;
  setup?: () => void;
  write: () => unknown;
}

const ROUTES: RouteCase[] = [
  {
    name: 'PUT /api/users/settings',
    send: () => request(app).put('/api/users/settings').send({ avatar: IMG }),
    write: () => updateUserSettingsMock
  },
  {
    name: 'PUT /api/profile/me',
    send: () => request(app).put('/api/profile/me').send({ avatar: IMG }),
    write: () => updateProfileMock
  },
  {
    name: 'POST /api/communities',
    setup: () => rankWith({ communities_manage: true }),
    send: () =>
      request(app).post('/api/communities').send({
        name: 'C',
        type: 'Music',
        registrationStatus: 'open',
        image: IMG
      }),
    write: () => prismaMock.community.create
  },
  {
    name: 'PUT /api/communities/:id',
    setup: () => {
      rankWith({ communities_manage: true });
      prismaMock.community.findUnique.mockResolvedValue({ id: 1 } as never);
    },
    send: () => request(app).put('/api/communities/1').send({ image: IMG }),
    write: () => prismaMock.community.update
  },
  {
    name: 'POST /api/announcements/album-of-month',
    setup: () => rankWith({ news_manage: true }),
    send: () =>
      request(app).post('/api/announcements/album-of-month').send({
        groupId: 1,
        threadId: 1,
        title: 'Album',
        image: IMG,
        started: '2026-01-01T00:00:00Z',
        ended: '2026-02-01T00:00:00Z'
      }),
    write: () => prismaMock.featuredAlbum.create
  },
  {
    name: 'POST /api/requests',
    send: () =>
      request(app).post('/api/requests').send({
        communityId: 1,
        type: 'Music',
        title: 'Wanted',
        description: 'Please',
        bounty: '209715200',
        image: IMG
      }),
    write: () => prismaMock.request.create
  },
  {
    name: 'PUT /api/requests/:id',
    setup: () =>
      prismaMock.request.findFirst.mockResolvedValue({
        userId: 7,
        status: 'open'
      } as never),
    send: () => request(app).put('/api/requests/1').send({ image: IMG }),
    write: () => prismaMock.request.update
  }
];

beforeEach(() => {
  resetApiTestState();
  // The member is at their ceiling, and the URL is new to the site.
  prismaMock.remoteImage.findMany.mockResolvedValue([]);
  prismaMock.remoteImage.count.mockResolvedValue(imageImport.dailyLimit);
});

const expectNothingWritten = (write: unknown) => {
  expect(write).not.toHaveBeenCalled();
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
  expect(prismaMock.remoteImage.createMany).not.toHaveBeenCalled();
};

describe('a route write of an image field past the ceiling', () => {
  it.each(ROUTES.map((c) => [c.name, c] as const))(
    '%s answers 429 and writes nothing',
    async (_name, c) => {
      c.setup?.();
      const res = await c.send();
      expect(res.status).toBe(429);
      expect(res.body.msg).toMatch(/new remote images/);
      expectNothingWritten(c.write());
    }
  );
});

interface ModuleCase {
  name: string;
  run: () => Promise<unknown>;
  setup?: () => void;
  write: () => unknown;
}

const MODULES: ModuleCase[] = [
  {
    name: 'updateDonorRewards',
    setup: () =>
      prismaMock.userDonorRank.findFirst.mockResolvedValue({
        donorRank: { perks: { customIcon: true } }
      } as never),
    run: () => donor.updateDonorRewards(7, { customIcon: IMG }),
    write: () => prismaMock.donorReward.upsert
  },
  {
    name: 'createCommunityRelease',
    setup: () =>
      prismaMock.community.findUnique.mockResolvedValue({ id: 1 } as never),
    run: () =>
      createCommunityRelease({
        actorId: 7,
        communityId: 1,
        data: { title: 'R', description: 'plain', image: IMG } as never
      }),
    write: () => prismaMock.release.create
  },
  {
    name: 'updateReleaseWorkbenchMetadata',
    setup: () =>
      prismaMock.release.findFirst.mockResolvedValue(RELEASE as never),
    run: () => updateReleaseWorkbenchMetadata(REF, { image: IMG }),
    write: () => prismaMock.release.update
  },
  {
    name: 'revertReleaseWorkbenchHistory',
    setup: () => {
      prismaMock.releaseHistory.findFirst.mockResolvedValue({
        action: 'edit',
        snapshot: { ...RELEASE, image: IMG, tagIds: [], tagNames: [] },
        after: null
      } as never);
      prismaMock.release.findFirst.mockResolvedValue(RELEASE as never);
    },
    run: () => revertReleaseWorkbenchHistory(REF, { historyId: 1 }),
    write: () => prismaMock.release.update
  },
  {
    name: 'createContributionSubmission',
    setup: () =>
      prismaMock.community.findUnique.mockResolvedValue({
        id: 1,
        registrationStatus: 'open'
      } as never),
    run: () =>
      contribution.createContributionSubmission({
        userId: 7,
        input: {
          communityId: 1,
          title: 'R',
          type: 'Music',
          sizeInBytes: 1,
          image: IMG,
          collaborators: []
        } as never
      }),
    write: () => prismaMock.release.create
  },
  {
    name: 'addGroupCover',
    setup: () =>
      prismaMock.releaseGroup.findFirst.mockResolvedValue({
        id: 1,
        title: 'Group',
        artist: null,
        releases: []
      } as never),
    run: () => addGroupCover({ actorId: 7, groupId: 1, image: IMG }),
    write: () => prismaMock.coverArt.create
  }
];

describe('a module write of an image field past the ceiling', () => {
  it.each(MODULES.map((c) => [c.name, c] as const))(
    '%s refuses with 429 and writes nothing',
    async (_name, c) => {
      c.setup?.();
      const err = await c.run().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(429);
      expectNothingWritten(c.write());
    }
  );
});
