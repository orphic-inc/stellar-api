/**
 * A reporter's links resolve as the reporter (#773, an instance of #771): a
 * target they cannot see links nowhere, exactly as a missing one does, so
 * their own report list cannot confirm a hidden id or name the community or
 * forum holding it. Staff see every link except one into a release page that
 * would refuse them: one they cannot see that no open report concerns
 * (ADR-0055 §3, #905).
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
const mockUnderOpenReport = jest.fn();

jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));
jest.mock('./comment', () => ({
  canSeeThreadOf: (...args: unknown[]) => mockCanSeeThreadOf(...args)
}));
jest.mock('./pm', () => ({ sendSystemMessage: jest.fn() }));
jest.mock('./reportedRelease', () => ({
  releasesUnderOpenReport: (...args: unknown[]) => mockUnderOpenReport(...args)
}));

import { ReportTargetType } from '@prisma/client';
import { releaseVisibleTo } from './communityAccess';
import {
  resolveSourceUrls,
  type SourceViewer,
  type StaffSourceViewer
} from './reportSourceUrls';
import { getReport, listMyReports } from './reports';

const REPORTER: SourceViewer = {
  id: 7,
  userRankLevel: 100,
  permittedForumIds: []
};
const one = (targetType: ReportTargetType, targetId: number) => [
  { id: 1, targetType, targetId }
];
const STAFF: StaffSourceViewer = { staffId: 8 };
const urlOf = async (
  targetType: ReportTargetType,
  targetId: number,
  viewer: SourceViewer | StaffSourceViewer = STAFF
) => (await resolveSourceUrls(one(targetType, targetId), viewer)).get(1);

/**
 * Release 42 in community 5. The resolver loads the row, then asks which ids
 * the viewer may see (a `where` with an `AND`): `visible` answers that.
 */
const releaseRows = (visible: number[]) =>
  prismaMock.release.findMany.mockImplementation(
    async (args: { where: { AND?: unknown } }) =>
      args.where.AND
        ? visible.map((id) => ({ id }))
        : [{ id: 42, communityId: 5 }]
  );
const visibilityLookup = (viewerId: number) =>
  expect.objectContaining({
    where: { AND: [{ id: { in: [42] } }, releaseVisibleTo(viewerId)] }
  });

describe('release and contribution targets', () => {
  beforeEach(() => {
    prismaMock.contribution.findMany.mockResolvedValue([
      { id: 99, releaseId: 42, release: { communityId: 5 } }
    ]);
    mockUnderOpenReport.mockResolvedValue(new Set());
  });

  it('scope the lookup to the reporter', async () => {
    releaseRows([42]);

    expect(await urlOf('Release', 42, REPORTER)).toBe(
      '/communities/5/releases/42'
    );
    expect(await urlOf('Contribution', 99, REPORTER)).toBe(
      '/communities/5/releases/42'
    );
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      visibilityLookup(7)
    );
    expect(mockUnderOpenReport).not.toHaveBeenCalled();
  });

  it('answer null when the reporter cannot see the release', async () => {
    releaseRows([]);
    expect(await urlOf('Release', 42, REPORTER)).toBeNull();
    expect(await urlOf('Contribution', 99, REPORTER)).toBeNull();
  });

  it('link staff to a release they can see as members', async () => {
    releaseRows([42]);
    expect(await urlOf('Release', 42)).toBe('/communities/5/releases/42');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      visibilityLookup(8)
    );
  });

  it('link staff to a release an open report concerns', async () => {
    releaseRows([]);
    mockUnderOpenReport.mockResolvedValue(new Set([42]));
    expect(await urlOf('Release', 42)).toBe('/communities/5/releases/42');
    expect(await urlOf('Contribution', 99)).toBe('/communities/5/releases/42');
    expect(mockUnderOpenReport).toHaveBeenCalledWith([42]);
  });

  it('answer null for staff when the page would refuse them', async () => {
    releaseRows([]);
    expect(await urlOf('Release', 42)).toBeNull();
    expect(await urlOf('Contribution', 99)).toBeNull();
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

  it('link staff to a release thread only when its page opens', async () => {
    prismaMock.comment.findMany.mockResolvedValue([
      {
        ...comment(5),
        page: 'release',
        releaseId: 42,
        release: { communityId: 5 }
      }
    ]);
    releaseRows([]);
    mockUnderOpenReport.mockResolvedValue(new Set());
    expect(await urlOf('Comment', 5)).toBeNull();

    mockUnderOpenReport.mockResolvedValue(new Set([42]));
    expect(await urlOf('Comment', 5)).toBe('/communities/5/releases/42');
  });

  // The old resolver `break`s out of its loop on a missing comment, so every
  // later report in the batch lost its link.
  it('still links the rest of a batch after a missing comment', async () => {
    prismaMock.comment.findMany.mockResolvedValue([comment(6)]);
    const urls = await resolveSourceUrls(
      [
        { id: 1, targetType: 'Comment', targetId: 5 },
        { id: 2, targetType: 'Comment', targetId: 6 }
      ],
      STAFF
    );
    expect(urls.get(1)).toBeNull();
    expect(urls.get(2)).toBe('/requests/10');
  });
});

// The reporter's own routes must hand the resolver their viewer; the staff
// view resolves as staff, which is what consults the open reports.
describe('who the report routes resolve as', () => {
  const row = { id: 1, targetType: 'Release', targetId: 42, reporterId: 7 };
  const scoped = visibilityLookup(7);

  beforeEach(() => {
    releaseRows([]);
    mockUnderOpenReport.mockResolvedValue(new Set());
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([row]);
    prismaMock.report.findUnique.mockResolvedValue(row);
  });

  it('listMyReports resolves as the reporter', async () => {
    await listMyReports(REPORTER, 1);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(scoped);
    expect(mockUnderOpenReport).not.toHaveBeenCalled();
  });

  it('getReport resolves as the reporter for their own report', async () => {
    await getReport(1, REPORTER, false);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(scoped);
    expect(mockUnderOpenReport).not.toHaveBeenCalled();
  });

  it('getReport resolves as staff for reports_manage', async () => {
    await getReport(1, REPORTER, true);
    expect(mockUnderOpenReport).toHaveBeenCalledWith([42]);
  });
});
