const prismaMock = {
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn()
  },
  release: {
    findMany: jest.fn()
  },
  contribution: {
    findMany: jest.fn()
  },
  forumTopic: {
    findMany: jest.fn()
  },
  forumPost: {
    findMany: jest.fn()
  },
  report: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn()
  },
  reportNote: {
    create: jest.fn()
  },
  auditLog: {
    create: jest.fn()
  }
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

jest.mock('./pm', () => ({
  sendSystemMessage: jest.fn().mockResolvedValue({ ok: true })
}));

import {
  addNote,
  claimReport,
  fileReport,
  getReport,
  getReportCounts,
  getReportStats,
  listMyReports,
  listReports,
  resolveReport,
  unclaimReport
} from './reports';
import { sendSystemMessage } from './pm';

const mockSendSystemMessage = sendSystemMessage as jest.Mock;

const makeReport = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  reporterId: 7,
  reporter: { id: 7, username: 'reporter', avatar: null },
  targetType: 'ForumPost',
  targetId: 42,
  category: 'spam',
  releaseCategory: null,
  reason: 'Spam',
  evidence: null,
  status: 'Open',
  claimedById: null,
  claimedBy: null,
  claimedAt: null,
  resolvedById: null,
  resolvedBy: null,
  resolvedAt: null,
  resolution: null,
  resolutionAction: null,
  notes: [],
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  ...overrides
});

describe('fileReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a report with include data and null sourceUrl', async () => {
    prismaMock.report.create.mockResolvedValue(makeReport());

    const result = await fileReport(7, {
      targetType: 'ForumPost',
      targetId: 42,
      category: 'spam',
      reason: 'Spam'
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterId: 7,
          targetType: 'ForumPost',
          targetId: 42,
          category: 'spam',
          reason: 'Spam'
        })
      })
    );
    expect(result.report.sourceUrl).toBeNull();
  });
});

describe('listReports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns no reports when reporter username does not resolve', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const result = await listReports({
      page: 1,
      status: 'Open',
      targetType: 'all',
      claimedByMe: false,
      staffUserId: 7,
      reporterUsername: 'ghost'
    });

    expect(result).toEqual({ total: 0, page: 1, pageSize: 25, reports: [] });
  });

  it('maps source URLs for forum posts and claimed-by-me filters', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      makeReport({ id: 9, status: 'Claimed', claimedById: 7 })
    ]);
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 5, forumTopic: { forumId: 3 } }
    ]);

    const result = await listReports({
      page: 2,
      status: 'Open',
      targetType: 'ForumPost',
      claimedByMe: true,
      staffUserId: 7
    });

    expect(prismaMock.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['Open', 'Claimed'] },
          targetType: 'ForumPost',
          claimedById: 7
        },
        skip: 25,
        take: 25
      })
    );
    expect(result.reports[0].sourceUrl).toBe('/private/forums/3/topics/5');
  });
});

describe('getReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns not_found and forbidden variants', async () => {
    prismaMock.report.findUnique.mockResolvedValueOnce(null);
    await expect(getReport(1, 7, false)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce(
      makeReport({ reporterId: 9 })
    );
    await expect(getReport(1, 7, false)).resolves.toEqual({
      ok: false,
      reason: 'forbidden'
    });
  });

  it('resolves source URL for visible reports', async () => {
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({ targetType: 'User', targetId: 11 })
    );
    prismaMock.user.findMany.mockResolvedValue([{ id: 11, username: 'alice' }]);

    const result = await getReport(1, 7, true);

    expect(result).toEqual({
      ok: true,
      report: expect.objectContaining({
        sourceUrl: '/private/user/alice'
      })
    });
  });
});

describe('claimReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns reason variants and claims open reports', async () => {
    prismaMock.report.findUnique.mockResolvedValueOnce(null);
    await expect(claimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Resolved',
      claimedById: null
    });
    await expect(claimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'resolved'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Open',
      claimedById: 9
    });
    await expect(claimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'already_claimed'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Open',
      claimedById: null
    });
    prismaMock.report.update.mockResolvedValue(undefined);
    await expect(claimReport(1, 7)).resolves.toEqual({ ok: true });
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Claimed', claimedById: 7, claimedAt: expect.any(Date) }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 7,
          action: 'report.claim',
          targetId: 1
        })
      })
    );
  });
});

describe('unclaimReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns reason variants and unclaims owned reports', async () => {
    prismaMock.report.findUnique.mockResolvedValueOnce(null);
    await expect(unclaimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Open',
      claimedById: 7
    });
    await expect(unclaimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_claimed'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Claimed',
      claimedById: 9
    });
    await expect(unclaimReport(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'forbidden'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({
      status: 'Claimed',
      claimedById: 7
    });
    prismaMock.report.update.mockResolvedValue(undefined);
    await expect(unclaimReport(1, 7)).resolves.toEqual({ ok: true });
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Open', claimedById: null, claimedAt: null }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 7, action: 'report.unclaim' })
      })
    );
  });
});

describe('resolveReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('atomically resolves reports and maps compare-and-swap misses', async () => {
    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(resolveReport(1, 7, 'Handled', 'UserWarned')).resolves.toEqual(
      {
        ok: true
      }
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 7,
          action: 'report.resolve',
          targetId: 1,
          metadata: { resolutionAction: 'UserWarned' }
        })
      })
    );

    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.report.findUnique.mockResolvedValueOnce({ id: 1 });
    await expect(resolveReport(1, 7, 'Handled', 'UserWarned')).resolves.toEqual(
      {
        ok: false,
        reason: 'already_resolved'
      }
    );

    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.report.findUnique.mockResolvedValueOnce(null);
    await expect(resolveReport(1, 7, 'Handled', 'UserWarned')).resolves.toEqual(
      {
        ok: false,
        reason: 'not_found'
      }
    );
  });

  it('sends a null-sender System PM to the reporter on resolve', async () => {
    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.report.findUnique.mockResolvedValueOnce({ reporterId: 42 });

    await expect(
      resolveReport(9, 7, 'Removed the offending post', 'ContentRemoved')
    ).resolves.toEqual({ ok: true });

    expect(mockSendSystemMessage).toHaveBeenCalledTimes(1);
    const [toId, , body] = mockSendSystemMessage.mock.calls[0];
    expect(toId).toBe(42);
    expect(body).toContain('Removed the offending post');
    expect(body).toContain('ContentRemoved');
    expect(body).toContain('/private/reports/9');
  });

  it('does not fail the resolve when the System PM send throws', async () => {
    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.report.findUnique.mockResolvedValueOnce({ reporterId: 42 });
    mockSendSystemMessage.mockRejectedValueOnce(new Error('pm boom'));

    await expect(resolveReport(9, 7, 'Handled', 'Dismissed')).resolves.toEqual({
      ok: true
    });
  });
});

describe('addNote', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns not_found when the report is missing and creates notes otherwise', async () => {
    prismaMock.report.findUnique.mockResolvedValueOnce(null);
    await expect(addNote(1, 7, 'Investigating')).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.report.findUnique.mockResolvedValueOnce({ id: 1 });
    prismaMock.reportNote.create.mockResolvedValue({
      id: 2,
      reportId: 1,
      authorId: 7,
      body: 'Investigating',
      createdAt: new Date(),
      author: { id: 7, username: 'staff', avatar: null }
    });
    await expect(addNote(1, 7, 'Investigating')).resolves.toEqual({
      ok: true,
      note: expect.objectContaining({ body: 'Investigating' })
    });
  });
});

describe('listMyReports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps contribution source URLs into report summaries', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      {
        id: 4,
        targetType: 'Contribution',
        targetId: 99,
        category: 'bad_upload',
        releaseCategory: null,
        status: 'Resolved',
        createdAt: new Date(),
        resolvedAt: null,
        resolution: null
      }
    ]);
    prismaMock.contribution.findMany.mockResolvedValue([
      { id: 99, releaseId: 123, release: { communityId: 5 } }
    ]);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBe(
      '/private/communities/5/releases/123'
    );
  });
});

describe('getReportCounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns open and claimed counts', async () => {
    prismaMock.report.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

    await expect(getReportCounts()).resolves.toEqual({ open: 3, claimed: 2 });
  });
});

describe('getReportStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns time-window counts and staff leaderboard', async () => {
    prismaMock.report.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(10);
    prismaMock.report.groupBy.mockResolvedValue([
      { resolvedById: 7, _count: { id: 6 } },
      { resolvedById: 9, _count: { id: 4 } }
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 7, username: 'alice' },
      { id: 9, username: 'bob' }
    ]);

    const result = await getReportStats();

    expect(result).toEqual({
      last24h: 1,
      lastWeek: 2,
      lastMonth: 3,
      allTime: 10,
      byStaff: [
        { userId: 7, username: 'alice', count: 6 },
        { userId: 9, username: 'bob', count: 4 }
      ]
    });
  });
});
