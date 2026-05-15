/**
 * Prisma contract tests — verify module functions produce the correct DB
 * call shapes and return value shapes, using the mocked Prisma client directly.
 */

import { prismaMock, resetApiTestState } from './test/apiTestHarness';
import {
  fileReport,
  listMyReports,
  getReport,
  claimReport,
  unclaimReport,
  resolveReport,
  addNote
} from './modules/reports';
import type * as PmModule from './modules/pm';
const { listInbox } = jest.requireActual<typeof PmModule>('./modules/pm');
import type * as ForumModule from './modules/forum';
const { deletePost } =
  jest.requireActual<typeof ForumModule>('./modules/forum');

beforeEach(() => resetApiTestState());

// ─── reports.fileReport ───────────────────────────────────────────────────────

describe('reports.fileReport', () => {
  const baseReport = {
    id: 1,
    reporterId: 7,
    reporter: { id: 7, username: 'alice', avatar: null },
    targetType: 'ForumPost' as const,
    targetId: 42,
    category: 'spam',
    releaseCategory: null,
    reason: 'This is spam',
    evidence: null,
    status: 'Open' as const,
    claimedById: null,
    claimedBy: null,
    claimedAt: null,
    resolvedById: null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    resolutionAction: null,
    notes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceUrl: null
  };

  it('creates a Report row with correct fields', async () => {
    prismaMock.report.create.mockResolvedValue(baseReport);

    const result = await fileReport(7, {
      targetType: 'ForumPost',
      targetId: 42,
      category: 'spam',
      reason: 'This is spam'
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reporterId: 7,
          targetType: 'ForumPost',
          targetId: 42,
          category: 'spam',
          reason: 'This is spam',
          evidence: undefined
        }
      })
    );
  });

  it('attaches sourceUrl: null on the returned report', async () => {
    prismaMock.report.create.mockResolvedValue(baseReport);

    const result = await fileReport(7, {
      targetType: 'ForumPost',
      targetId: 42,
      category: 'spam',
      reason: 'reason'
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.sourceUrl).toBe(null);
    }
  });

  it('includes evidence when provided', async () => {
    prismaMock.report.create.mockResolvedValue({
      ...baseReport,
      evidence: 'https://example.com/screenshot.png'
    });

    await fileReport(7, {
      targetType: 'ForumPost',
      targetId: 42,
      category: 'spam',
      reason: 'reason',
      evidence: 'https://example.com/screenshot.png'
    });

    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidence: 'https://example.com/screenshot.png'
        })
      })
    );
  });
});

// ─── reports.listMyReports ────────────────────────────────────────────────────

describe('reports.listMyReports', () => {
  const summary = {
    id: 1,
    targetType: 'ForumPost' as const,
    targetId: 42,
    category: 'spam',
    status: 'Open' as const,
    createdAt: new Date(),
    resolvedAt: null,
    resolution: null
  };

  it('queries by reporterId and returns paginated result', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([summary] as never);
    // resolveSourceUrls calls forumPost.findMany for ForumPost targets
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 5, forumTopic: { forumId: 3 } }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(prismaMock.report.count).toHaveBeenCalledWith({
      where: { reporterId: 7 }
    });
    expect(result.total).toBe(1);
    expect(result.reports).toHaveLength(1);
  });

  it('resolves sourceUrl for ForumPost targets', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([summary] as never);
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 5, forumTopic: { forumId: 3 } }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBe('/private/forums/3/topics/5');
  });
});

// ─── pm.listInbox ─────────────────────────────────────────────────────────────

describe('pm.listInbox', () => {
  const conversation = {
    id: 1,
    subject: 'Hello',
    isStaffTicket: false,
    ticketStatus: null,
    assignedStaffId: null,
    assignedStaff: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: [
      {
        userId: 7,
        conversationId: 1,
        inInbox: true,
        inSentbox: false,
        isRead: false,
        isSticky: false,
        forwardedToId: null,
        sentAt: null,
        receivedAt: new Date()
      }
    ],
    messages: [
      {
        id: 10,
        conversationId: 1,
        senderId: 3,
        body: 'Hey there',
        createdAt: new Date(),
        sender: { id: 3, username: 'sender', avatar: null }
      }
    ]
  };

  it('filters by userId participant in inbox', async () => {
    prismaMock.privateConversation.count.mockResolvedValue(1);
    prismaMock.privateConversation.findMany.mockResolvedValue([
      conversation
    ] as never);

    const result = await listInbox(7, 1, undefined);

    expect(prismaMock.privateConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          participants: expect.objectContaining({
            some: expect.objectContaining({ userId: 7, inInbox: true })
          })
        })
      })
    );
    expect(result.total).toBe(1);
    expect(result.conversations).toHaveLength(1);
  });

  it('returns correct pagination shape', async () => {
    prismaMock.privateConversation.count.mockResolvedValue(0);
    prismaMock.privateConversation.findMany.mockResolvedValue([]);

    const result = await listInbox(7, 2, undefined);

    expect(result).toMatchObject({ total: 0, page: 2, conversations: [] });
    expect(result).toHaveProperty('pageSize');
  });
});

// ─── reports.getReport ────────────────────────────────────────────────────────

describe('reports.getReport', () => {
  const baseReport = {
    id: 1,
    reporterId: 7,
    reporter: { id: 7, username: 'alice', avatar: null },
    targetType: 'ForumPost' as const,
    targetId: 42,
    category: 'spam',
    releaseCategory: null,
    reason: 'This is spam',
    evidence: null,
    status: 'Open' as const,
    claimedById: null,
    claimedBy: null,
    claimedAt: null,
    resolvedById: null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    resolutionAction: null,
    notes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceUrl: null
  };

  it('returns not_found when report does not exist', async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await getReport(1, 7, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('returns forbidden when non-staff requester is not the reporter', async () => {
    prismaMock.report.findUnique.mockResolvedValue(baseReport);
    const result = await getReport(1, 99, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });

  it('resolves sourceUrl for ForumPost targets', async () => {
    prismaMock.report.findUnique.mockResolvedValue(baseReport);
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 5, forumTopic: { forumId: 3 } }
    ] as never);

    const result = await getReport(1, 7, false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.sourceUrl).toBe('/private/forums/3/topics/5');
    }
  });

  it('allows staff to view any report regardless of reporter', async () => {
    prismaMock.report.findUnique.mockResolvedValue(baseReport);
    prismaMock.forumPost.findMany.mockResolvedValue([
      { id: 42, forumTopicId: 5, forumTopic: { forumId: 3 } }
    ] as never);

    const result = await getReport(1, 99, true);
    expect(result.ok).toBe(true);
  });
});

// ─── reports.claimReport ──────────────────────────────────────────────────────

describe('reports.claimReport', () => {
  it('claims an open report and sets status to Claimed', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Open',
      claimedById: null
    } as never);
    prismaMock.report.update.mockResolvedValue({} as never);

    const result = await claimReport(1, 7);

    expect(result.ok).toBe(true);
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Claimed', claimedById: 7 })
      })
    );
  });

  it('returns not_found when report does not exist', async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await claimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('returns resolved when report is already resolved', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Resolved',
      claimedById: null
    } as never);
    const result = await claimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('resolved');
  });

  it('returns already_claimed when another staff member claimed it', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Claimed',
      claimedById: 99
    } as never);
    const result = await claimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_claimed');
  });
});

// ─── reports.unclaimReport ────────────────────────────────────────────────────

describe('reports.unclaimReport', () => {
  it('unclames a report owned by the requester', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Claimed',
      claimedById: 7
    } as never);
    prismaMock.report.update.mockResolvedValue({} as never);

    const result = await unclaimReport(1, 7);

    expect(result.ok).toBe(true);
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Open', claimedById: null })
      })
    );
  });

  it('returns not_found when report does not exist', async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await unclaimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('returns not_claimed when report is not in Claimed status', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Open',
      claimedById: null
    } as never);
    const result = await unclaimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_claimed');
  });

  it('returns forbidden when a different staff member tries to unclaim', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Claimed',
      claimedById: 99
    } as never);
    const result = await unclaimReport(1, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });
});

// ─── reports.resolveReport ───────────────────────────────────────────────────

describe('reports.resolveReport', () => {
  it('resolves an open report', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Open'
    } as never);
    prismaMock.report.update.mockResolvedValue({} as never);

    const result = await resolveReport(1, 7, 'Confirmed spam', 'UserWarned');

    expect(result.ok).toBe(true);
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'Resolved',
          resolvedById: 7,
          resolution: 'Confirmed spam',
          resolutionAction: 'UserWarned'
        })
      })
    );
  });

  it('returns not_found when report does not exist', async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await resolveReport(1, 7, 'reason', 'UserWarned');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('returns already_resolved when report is already resolved', async () => {
    prismaMock.report.findUnique.mockResolvedValue({
      status: 'Resolved'
    } as never);
    const result = await resolveReport(1, 7, 'reason', 'UserWarned');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_resolved');
  });
});

// ─── reports.addNote ─────────────────────────────────────────────────────────

describe('reports.addNote', () => {
  const noteRow = {
    id: 1,
    reportId: 1,
    authorId: 7,
    author: { id: 7, username: 'alice', avatar: null },
    body: 'Looks like spam',
    createdAt: new Date()
  };

  it('creates a note on an existing report', async () => {
    prismaMock.report.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.reportNote.create.mockResolvedValue(noteRow as never);

    const result = await addNote(1, 7, 'Looks like spam');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note.body).toBe('Looks like spam');
      expect(result.note.authorId).toBe(7);
    }
    expect(prismaMock.reportNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: 1,
          authorId: 7,
          body: 'Looks like spam'
        })
      })
    );
  });

  it('returns not_found when report does not exist', async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await addNote(1, 7, 'note');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

// ─── forum.deletePost ─────────────────────────────────────────────────────────

describe('forum.deletePost', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    });
    prismaMock.forumPost.update.mockResolvedValue({} as never);
    prismaMock.forumTopic.update.mockResolvedValue({} as never);
    prismaMock.forum.update.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('soft-deletes the post and decrements counters without touching the topic', async () => {
    prismaMock.forumPost.count.mockResolvedValue(1);

    await deletePost(21, 44, 9, 7, false);

    expect(prismaMock.forumPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 21 },
        data: { deletedAt: expect.any(Date) }
      })
    );
    expect(prismaMock.forumTopic.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.forumTopic.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { numPosts: { decrement: 1 } } })
    );
  });

  it('also soft-deletes the topic when the deleted post was the last one', async () => {
    prismaMock.forumPost.count.mockResolvedValue(0);

    await deletePost(21, 44, 9, 7, false);

    expect(prismaMock.forumTopic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 44 },
        data: { deletedAt: expect.any(Date) }
      })
    );
    expect(prismaMock.forum.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { numTopics: { decrement: 1 } } })
    );
  });
});
