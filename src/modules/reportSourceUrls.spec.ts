/**
 * A reporter's links resolve as the reporter (#773, an instance of #771): a
 * target they cannot see links nowhere, exactly as a missing one does, so
 * their own report list cannot confirm a hidden id or name the community or
 * forum holding it. Staff, passing no viewer, see every link.
 */

const prismaMock = {
  user: { findMany: jest.fn() },
  release: { findMany: jest.fn() },
  contribution: { findMany: jest.fn() },
  forumTopic: { findMany: jest.fn() },
  forumPost: { findMany: jest.fn() },
  comment: { findMany: jest.fn() },
  report: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() }
};
const mockCanSeeThreadOf = jest.fn();

jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));
jest.mock('./comment', () => ({
  canSeeThreadOf: (...args: unknown[]) => mockCanSeeThreadOf(...args)
}));
jest.mock('./pm', () => ({ sendSystemMessage: jest.fn() }));

import { ReportTargetType } from '@prisma/client';
import { contributionVisibleTo, releaseVisibleTo } from './communityAccess';
import { resolveSourceUrls, type SourceViewer } from './reportSourceUrls';
import { getReport, listMyReports } from './reports';

const REPORTER: SourceViewer = {
  id: 7,
  userRankLevel: 100,
  permittedForumIds: []
};
const one = (targetType: ReportTargetType, targetId: number) => [
  { id: 1, targetType, targetId }
];
const urlOf = async (
  targetType: ReportTargetType,
  targetId: number,
  viewer?: SourceViewer
) => (await resolveSourceUrls(one(targetType, targetId), viewer)).get(1);

describe('release and contribution targets', () => {
  it('scope the lookup to the reporter', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.contribution.findMany.mockResolvedValue([]);

    await urlOf('Release', 42, REPORTER);
    await urlOf('Contribution', 99, REPORTER);

    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: { in: [42] } }, releaseVisibleTo(7)] }
      })
    );
    expect(prismaMock.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: { in: [99] } }, contributionVisibleTo(7)] }
      })
    );
  });

  it('answer null when the scoped lookup finds nothing', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    expect(await urlOf('Release', 42, REPORTER)).toBeNull();
  });

  it('are unscoped for staff', async () => {
    prismaMock.release.findMany.mockResolvedValue([{ id: 42, communityId: 5 }]);

    expect(await urlOf('Release', 42)).toBe('/communities/5/releases/42');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: { in: [42] } }, {}] } })
    );
  });
});

describe('forum topic and post targets', () => {
  const restricted = { id: 3, minClassRead: 500 };

  beforeEach(() => {
    prismaMock.forumTopic.findMany.mockResolvedValue([
      { id: 44, forum: restricted }
    ]);
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 44, forumTopic: { forum: restricted } }
    ]);
  });

  it('answer null for a forum above the reporter rank', async () => {
    expect(await urlOf('ForumTopic', 44, REPORTER)).toBeNull();
    expect(await urlOf('ForumPost', 42, REPORTER)).toBeNull();
  });

  it('link a forum the reporter is permitted into despite rank', async () => {
    const permitted = { ...REPORTER, permittedForumIds: [3] };
    expect(await urlOf('ForumTopic', 44, permitted)).toBe(
      '/forums/3/topics/44'
    );
    expect(await urlOf('ForumPost', 42, permitted)).toBe('/forums/3/topics/44');
  });

  it('link every forum for staff', async () => {
    expect(await urlOf('ForumTopic', 44)).toBe('/forums/3/topics/44');
  });
});

describe('comment targets', () => {
  const comment = (id: number) => ({
    id,
    page: 'requests',
    requestId: 10,
    artistId: null,
    releaseId: null,
    release: null,
    collageId: null,
    communityId: null,
    contributionId: null,
    contribution: null
  });

  it('answer null when the reporter cannot see the thread', async () => {
    prismaMock.comment.findMany.mockResolvedValue([comment(5)]);
    mockCanSeeThreadOf.mockResolvedValue(false);

    expect(await urlOf('Comment', 5, REPORTER)).toBeNull();
    expect(mockCanSeeThreadOf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      7
    );
  });

  it('link the thread when the reporter can see it', async () => {
    prismaMock.comment.findMany.mockResolvedValue([comment(5)]);
    mockCanSeeThreadOf.mockResolvedValue(true);

    expect(await urlOf('Comment', 5, REPORTER)).toBe('/requests/10');
  });

  it('skip the thread check for staff', async () => {
    prismaMock.comment.findMany.mockResolvedValue([comment(5)]);

    expect(await urlOf('Comment', 5)).toBe('/requests/10');
    expect(mockCanSeeThreadOf).not.toHaveBeenCalled();
  });

  // The old resolver `break`s out of its loop on a missing comment, so every
  // later report in the batch lost its link.
  it('still links the rest of a batch after a missing comment', async () => {
    prismaMock.comment.findMany.mockResolvedValue([comment(6)]);
    const urls = await resolveSourceUrls([
      { id: 1, targetType: 'Comment', targetId: 5 },
      { id: 2, targetType: 'Comment', targetId: 6 }
    ]);
    expect(urls.get(1)).toBeNull();
    expect(urls.get(2)).toBe('/requests/10');
  });
});

// The reporter's own routes must hand the resolver their viewer; the staff
// view must not.
describe('who the report routes resolve as', () => {
  const row = { id: 1, targetType: 'Release', targetId: 42, reporterId: 7 };
  const scoped = {
    where: { AND: [{ id: { in: [42] } }, releaseVisibleTo(7)] }
  };

  beforeEach(() => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([row]);
    prismaMock.report.findUnique.mockResolvedValue(row);
  });

  it('listMyReports resolves as the reporter', async () => {
    await listMyReports(REPORTER, 1);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining(scoped)
    );
  });

  it('getReport resolves as the reporter for their own report', async () => {
    await getReport(1, REPORTER, false);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining(scoped)
    );
  });

  it('getReport resolves unscoped for staff', async () => {
    await getReport(1, REPORTER, true);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: { in: [42] } }, {}] } })
    );
  });
});
