/**
 * Every write of a prose field the api renders registers its remote images
 * first (#737, ADR-0051), so a write past the member's daily ceiling is refused
 * with 429 and writes nothing.
 *
 * Each case runs the real `registerRemoteImages` against the Prisma mock, set
 * at the ceiling, and asserts the refusal came before any write. A surface
 * that stops registering answers its normal status instead, so each case fails
 * on its own.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions,
  updateProfileMock
} from './test/apiTestHarness';
import { makeCollage, makeComment } from './test/factories';
import { imageImport } from './modules/config';
import { AppError } from './lib/errors';

jest.mock('./modules/comment', () => ({
  deleteComment: jest.fn(),
  canSeeCommentThread: async () => true,
  canSeeThreadOf: async () => true
}));

jest.mock('./modules/releaseWorkbench/authority', () => ({
  loadReleaseWorkbenchAuthority: async () => ({
    canEditMetadata: true,
    canRevertHistory: true
  })
}));

const forum: typeof import('./modules/forum') =
  jest.requireActual('./modules/forum');
const contribution: typeof import('./modules/contribution') =
  jest.requireActual('./modules/contribution');
import { createCommunityRelease } from './modules/releaseLifecycle';
import { updateReleaseWorkbenchMetadata } from './modules/releaseWorkbench/metadata';
import { revertReleaseWorkbenchHistory } from './modules/releaseWorkbench/history';

const IMG_URL = 'https://images.example/new.png';
const BODY = `A body long enough for every schema, with an image: [img]${IMG_URL}[/img]`;

const WIKI_PAGE = {
  id: 2,
  title: 'Page',
  slug: 'page',
  revision: 1,
  minReadLevel: 0,
  minEditLevel: 0,
  authorId: 7,
  body: 'old body',
  deletedAt: null
};

const RELEASE = {
  id: 3,
  communityId: 1,
  title: 'Release',
  description: 'old description',
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
    name: 'POST /api/comments',
    send: () =>
      request(app)
        .post('/api/comments')
        .send({ page: 'communities', body: BODY, communityId: 5 }),
    write: () => prismaMock.comment.create
  },
  {
    name: 'PUT /api/comments/:id',
    setup: () =>
      prismaMock.comment.findUnique.mockResolvedValue(
        makeComment({ id: 1, authorId: 7 })
      ),
    send: () => request(app).put('/api/comments/1').send({ body: BODY }),
    write: () => prismaMock.comment.update
  },
  {
    name: 'POST /api/collages',
    setup: () => prismaMock.collage.findFirst.mockResolvedValue(null),
    send: () =>
      request(app)
        .post('/api/collages')
        .send({ name: 'Collage', description: BODY, categoryId: 1 }),
    write: () => prismaMock.collage.create
  },
  {
    name: 'PUT /api/collages/:id',
    setup: () => prismaMock.collage.findUnique.mockResolvedValue(makeCollage()),
    send: () => request(app).put('/api/collages/1').send({ description: BODY }),
    write: () => prismaMock.collage.update
  },
  {
    name: 'POST /api/wiki',
    setup: () => {
      rankWith({ wiki_edit: true });
      prismaMock.wikiPage.findUnique.mockResolvedValue(null);
    },
    send: () =>
      request(app).post('/api/wiki').send({ title: 'New', body: BODY }),
    write: () => prismaMock.wikiPage.create
  },
  {
    name: 'PUT /api/wiki/:id',
    setup: () => {
      rankWith({ wiki_edit: true });
      prismaMock.wikiPage.findFirst.mockResolvedValue(WIKI_PAGE as never);
    },
    send: () => request(app).put('/api/wiki/2').send({ body: BODY }),
    write: () => prismaMock.wikiPage.update
  },
  {
    name: 'POST /api/wiki/:id/rollback/:rev',
    setup: () => {
      rankWith({ wiki_edit: true });
      prismaMock.wikiPage.findFirst.mockResolvedValue(WIKI_PAGE as never);
      prismaMock.wikiRevision.findUnique.mockResolvedValue({
        pageId: 2,
        revision: 1,
        title: 'Page',
        body: BODY,
        authorId: 7
      } as never);
    },
    send: () => request(app).post('/api/wiki/2/rollback/1'),
    write: () => prismaMock.wikiPage.update
  },
  {
    name: 'POST /api/announcements',
    setup: () => rankWith({ news_manage: true }),
    send: () =>
      request(app).post('/api/announcements').send({ title: 'T', body: BODY }),
    write: () => prismaMock.news.create
  },
  {
    name: 'PUT /api/announcements/:id',
    setup: () => rankWith({ news_manage: true }),
    send: () =>
      request(app).put('/api/announcements/1').send({ title: 'T', body: BODY }),
    write: () => prismaMock.news.update
  },
  {
    name: 'PUT /api/profile/me',
    send: () => request(app).put('/api/profile/me').send({ profileInfo: BODY }),
    write: () => updateProfileMock
  },
  {
    name: 'PUT /api/users/:id/staff-bio',
    setup: () => {
      rankWith({ admin: true, staff: true, users_edit: true });
      prismaMock.user.findUnique.mockResolvedValue({ id: 9 } as never);
    },
    send: () =>
      request(app).put('/api/users/9/staff-bio').send({ staffBio: BODY }),
    write: () => prismaMock.user.update
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

describe('a route write past the image ceiling', () => {
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
    name: 'createTopic',
    run: () => forum.createTopic(1, 7, { title: 'T', body: BODY }),
    write: () => prismaMock.forumPost.create
  },
  {
    name: 'createPost',
    run: () => forum.createPost(1, 1, 7, BODY),
    write: () => prismaMock.forumPost.create
  },
  {
    name: 'updatePost',
    run: () => forum.updatePost(1, 7, 'old', BODY, 1),
    write: () => prismaMock.forumPost.update
  },
  {
    name: 'createCommunityRelease',
    setup: () => {
      prismaMock.community.findUnique.mockResolvedValue({ id: 1 } as never);
      prismaMock.artist.count.mockResolvedValue(0);
    },
    run: () =>
      createCommunityRelease({
        actorId: 7,
        communityId: 1,
        data: { title: 'R', description: BODY, credits: [] } as never
      }),
    write: () => prismaMock.release.create
  },
  {
    name: 'updateReleaseWorkbenchMetadata',
    setup: () =>
      prismaMock.release.findFirst.mockResolvedValue(RELEASE as never),
    run: () =>
      updateReleaseWorkbenchMetadata(
        { actorId: 7, communityId: 1, releaseId: 3 } as never,
        { description: BODY }
      ),
    write: () => prismaMock.release.update
  },
  {
    name: 'revertReleaseWorkbenchHistory',
    setup: () => {
      prismaMock.releaseHistory.findFirst.mockResolvedValue({
        action: 'edit',
        snapshot: { ...RELEASE, description: BODY, tagIds: [], tagNames: [] },
        after: null
      } as never);
      prismaMock.release.findFirst.mockResolvedValue(RELEASE as never);
    },
    run: () =>
      revertReleaseWorkbenchHistory(
        { actorId: 7, communityId: 1, releaseId: 3 } as never,
        { historyId: 1 }
      ),
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
          description: BODY,
          tags: '',
          collaborators: []
        } as never
      }),
    write: () => prismaMock.release.create
  }
];

describe('a module write past the image ceiling', () => {
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

describe('a write under the ceiling', () => {
  it('queues the new URL, owned by the writer', async () => {
    prismaMock.remoteImage.count.mockResolvedValue(0);
    prismaMock.remoteImage.createMany.mockResolvedValue({ count: 1 });
    prismaMock.comment.create.mockResolvedValue(
      makeComment({ id: 20, body: BODY }) as never
    );

    await request(app)
      .post('/api/comments')
      .send({ page: 'communities', body: BODY, communityId: 5 });

    expect(prismaMock.remoteImage.createMany).toHaveBeenCalledWith({
      data: [{ url: IMG_URL, requestedById: 7 }],
      skipDuplicates: true
    });
  });
});
