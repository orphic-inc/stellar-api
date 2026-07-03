/**
 * Prisma contract tests — verify module functions produce the correct DB
 * call shapes and return value shapes, using the mocked Prisma client directly.
 */

import { prismaMock, resetApiTestState } from './test/apiTestHarness';
import type * as ReportsModule from './modules/reports';
const {
  fileReport,
  listMyReports,
  listReports,
  getReport,
  claimReport,
  unclaimReport,
  resolveReport,
  addNote
} = jest.requireActual<typeof ReportsModule>('./modules/reports');
import type * as PmModule from './modules/pm';
const { listInbox } = jest.requireActual<typeof PmModule>('./modules/pm');
import type * as ForumModule from './modules/forum';
const { deletePost, castVote, createPoll, closePoll, createTopicNote } =
  jest.requireActual<typeof ForumModule>('./modules/forum');
import type * as StaffInboxModule from './modules/staffInbox';
const {
  listMyTickets,
  listQueue,
  getQueueCount,
  viewTicket,
  replyToTicket,
  resolveTicket,
  unresolveTicket,
  assignTicket,
  bulkResolve
} = jest.requireActual<typeof StaffInboxModule>('./modules/staffInbox');

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

  it('resolves sourceUrl for Release targets', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      { ...summary, targetType: 'Release' as const, targetId: 42 }
    ] as never);
    prismaMock.release.findMany.mockResolvedValue([
      { id: 42, communityId: 5 }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBe(
      '/private/communities/5/releases/42'
    );
  });

  it('resolves sourceUrl as null for Release with no communityId', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      { ...summary, targetType: 'Release' as const, targetId: 42 }
    ] as never);
    prismaMock.release.findMany.mockResolvedValue([
      { id: 42, communityId: null }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBeNull();
  });

  it('resolves sourceUrl for ForumTopic targets', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      { ...summary, targetType: 'ForumTopic' as const, targetId: 44 }
    ] as never);
    prismaMock.forumTopic.findMany.mockResolvedValue([
      { id: 44, forumId: 9 }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBe('/private/forums/9/topics/44');
  });

  it('resolves sourceUrl for Collage targets', async () => {
    prismaMock.report.count.mockResolvedValue(1);
    prismaMock.report.findMany.mockResolvedValue([
      { ...summary, targetType: 'Collage' as const, targetId: 7 }
    ] as never);

    const result = await listMyReports(7, 1);

    expect(result.reports[0].sourceUrl).toBe('/private/collages/7');
  });
});

// ─── reports.listReports ──────────────────────────────────────────────────────

describe('reports.listReports', () => {
  it('returns empty when reporterUsername does not match any user', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const result = await listReports({
      page: 1,
      status: 'all',
      targetType: 'all',
      claimedByMe: false,
      staffUserId: 7,
      reporterUsername: 'ghost'
    });

    expect(result.total).toBe(0);
    expect(result.reports).toHaveLength(0);
    expect(prismaMock.report.findMany).not.toHaveBeenCalled();
  });

  it('queries reports filtered by status and target type', async () => {
    prismaMock.report.count.mockResolvedValue(2);
    prismaMock.report.findMany.mockResolvedValue([]);

    await listReports({
      page: 1,
      status: 'Open',
      targetType: 'ForumPost',
      claimedByMe: false,
      staffUserId: 7
    });

    expect(prismaMock.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Open', targetType: 'ForumPost' }
      })
    );
  });
});

// ─── pm.listInbox ─────────────────────────────────────────────────────────────

describe('pm.listInbox', () => {
  const conversation = {
    id: 1,
    subject: 'Hello',
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
  it('resolves an open report atomically', async () => {
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await resolveReport(1, 7, 'Confirmed spam', 'UserWarned');

    expect(result.ok).toBe(true);
    expect(prismaMock.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, status: { not: 'Resolved' } }),
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
    prismaMock.report.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.report.findUnique.mockResolvedValue(null);
    const result = await resolveReport(1, 7, 'reason', 'UserWarned');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('returns already_resolved when report is already resolved', async () => {
    prismaMock.report.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.report.findUnique.mockResolvedValue({ id: 1 } as never);
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

// ─── forum.castVote ───────────────────────────────────────────────────────────

describe('forum.castVote', () => {
  const basePoll = {
    id: 1,
    forumTopicId: 44,
    question: 'Favorite genre?',
    answers: '["Jazz","Blues"]',
    closed: false,
    forumTopic: {
      deletedAt: null,
      forum: { minClassRead: 0 }
    }
  };

  beforeEach(() => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(basePoll as never);
    prismaMock.forumPollVote.upsert.mockResolvedValue({
      id: 1,
      forumPollId: 1,
      userId: 7,
      vote: 0
    } as never);
  });

  it('returns not_found when the poll does not exist', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(null);

    const result = await castVote(1, 7, 1000, 0);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when the poll topic is soft-deleted', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      ...basePoll,
      forumTopic: { ...basePoll.forumTopic, deletedAt: new Date() }
    } as never);

    const result = await castVote(1, 7, 1000, 0);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns insufficient_class when user rank is below forum minClassRead', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      ...basePoll,
      forumTopic: {
        deletedAt: null,
        forum: { minClassRead: 500 }
      }
    } as never);

    const result = await castVote(1, 7, 100, 0);

    expect(result).toEqual({ ok: false, reason: 'insufficient_class' });
  });

  it('returns invalid_vote when poll.answers is not valid JSON', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      ...basePoll,
      answers: 'not-json'
    } as never);

    const result = await castVote(1, 7, 1000, 0);

    expect(result).toEqual({ ok: false, reason: 'invalid_vote' });
  });
});

// ─── staffInbox.listMyTickets ────────────────────────────────────────────────────

describe('staffInbox.listMyTickets', () => {
  it('returns paginated ticket list for a user', async () => {
    prismaMock.staffInboxConversation.count.mockResolvedValue(1);
    prismaMock.staffInboxConversation.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        status: 'Unanswered',
        user: {
          id: 7,
          username: 'testuser',
          avatar: null,
          isDonor: false,
          warned: null,
          donorRank: null
        },
        assignedUser: null,
        resolver: null,
        messages: []
      }
    ] as never);

    const result = await listMyTickets(7, 1);

    expect(result.total).toBe(1);
    expect(result.conversations).toHaveLength(1);
    expect(prismaMock.staffInboxConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 } })
    );
  });
});

// ─── staffInbox.listQueue ────────────────────────────────────────────────────────

describe('staffInbox.listQueue', () => {
  it('returns all tickets when status=all', async () => {
    prismaMock.staffInboxConversation.count.mockResolvedValue(3);
    prismaMock.staffInboxConversation.findMany.mockResolvedValue([]);

    await listQueue({
      page: 1,
      status: 'all',
      assignedToMe: false,
      unassigned: false,
      staffUserId: 7
    });

    expect(prismaMock.staffInboxConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it('filters by assignedToMe and status', async () => {
    prismaMock.staffInboxConversation.count.mockResolvedValue(1);
    prismaMock.staffInboxConversation.findMany.mockResolvedValue([]);

    await listQueue({
      page: 1,
      status: 'Unanswered',
      assignedToMe: true,
      unassigned: false,
      staffUserId: 7
    });

    expect(prismaMock.staffInboxConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Unanswered', assignedUserId: 7 }
      })
    );
  });
});

// ─── staffInbox.getQueueCount ────────────────────────────────────────────────────

describe('staffInbox.getQueueCount', () => {
  it('counts non-resolved tickets', async () => {
    prismaMock.staffInboxConversation.count.mockResolvedValue(5);

    const count = await getQueueCount();

    expect(count).toBe(5);
    expect(prismaMock.staffInboxConversation.count).toHaveBeenCalledWith({
      where: { status: { not: 'Resolved' } }
    });
  });
});

// ─── staffInbox.replyToTicket (error paths) ──────────────────────────────────

describe('staffInbox.replyToTicket', () => {
  it('returns not_found when the ticket does not exist', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(null);

    const result = await replyToTicket(99, 7, 'hello', false);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it("masks a non-staff user replying to another user's ticket as not_found", async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue({
      id: 1,
      userId: 99,
      status: 'Unanswered'
    } as never);

    const result = await replyToTicket(1, 7, 'hello', false);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

// ─── staffInbox.resolveTicket (error paths) ──────────────────────────────────

describe('staffInbox.resolveTicket', () => {
  it("masks a non-staff user resolving another user's ticket as not_found", async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue({
      id: 1,
      userId: 99,
      status: 'Unanswered'
    } as never);

    const result = await resolveTicket(1, 7, false);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns already_resolved when the ticket is already resolved', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue({
      id: 1,
      userId: 7,
      status: 'Resolved'
    } as never);

    const result = await resolveTicket(1, 7, true);

    expect(result).toEqual({ ok: false, reason: 'already_resolved' });
  });
});

// ─── staffInbox.unresolveTicket (error paths) ─────────────────────────────────

describe('staffInbox.unresolveTicket', () => {
  it('returns not_resolved when ticket is not in Resolved status', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue({
      id: 1,
      status: 'Unanswered'
    } as never);

    const result = await unresolveTicket(1, 7);

    expect(result).toEqual({ ok: false, reason: 'not_resolved' });
  });
});

// ─── forum.createPoll / closePoll / createTopicNote ───────────────────────────

describe('forum.createPoll', () => {
  it('creates a poll with the given fields', async () => {
    prismaMock.forumPoll.create.mockResolvedValue({ id: 1 } as never);

    await createPoll(44, 'Favorite?', '["A","B"]');

    expect(prismaMock.forumPoll.create).toHaveBeenCalledWith({
      data: { forumTopicId: 44, question: 'Favorite?', answers: '["A","B"]' }
    });
  });
});

describe('forum.closePoll', () => {
  it('sets closed=true on the poll', async () => {
    prismaMock.forumPoll.update.mockResolvedValue({
      id: 1,
      closed: true
    } as never);

    await closePoll(1);

    expect(prismaMock.forumPoll.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { closed: true }
    });
  });
});

describe('forum.createTopicNote', () => {
  it('creates a topic note', async () => {
    prismaMock.forumTopicNote.create.mockResolvedValue({ id: 77 } as never);

    await createTopicNote(44, 7, 'staff note');

    expect(prismaMock.forumTopicNote.create).toHaveBeenCalledWith({
      data: { forumTopicId: 44, authorId: 7, body: 'staff note' }
    });
  });
});

// ─── ratioPolicy.getPolicyState ───────────────────────────────────────────────

import type * as RatioPolicyModule from './modules/ratioPolicy';
const { getPolicyState } = jest.requireActual<typeof RatioPolicyModule>(
  './modules/ratioPolicy'
);

describe('ratioPolicy.getPolicyState', () => {
  it('returns default OK state when no policy record exists', async () => {
    prismaMock.ratioPolicyState.findUnique.mockResolvedValue(null);

    const result = await getPolicyState(9);

    expect(result.status).toBe('OK');
    expect(result.watchStartedAt).toBeNull();
    expect(result.leechDisabledAt).toBeNull();
    expect(result.lastEvaluatedAt).toBeDefined();
  });
});

// ─── requests module ──────────────────────────────────────────────────────────

import type * as RequestsModule from './modules/requestLifecycle';
const { createRequest, unfillRequest, serializeRequest, listRequests } =
  jest.requireActual<typeof RequestsModule>('./modules/requestLifecycle');

describe('requests.createRequest', () => {
  it('includes artist associations when artists array is provided', async () => {
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 7,
      contributed: BigInt(2e9),
      consumed: BigInt(0)
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({} as never);
    prismaMock.request.create.mockResolvedValueOnce({
      id: 1,
      status: 'open',
      fillerId: null,
      filledAt: null,
      filledContributionId: null,
      voteCount: 0,
      bounties: [{ amount: BigInt(110_000_000) }],
      artists: [{ artistId: 5 }]
    } as never);
    prismaMock.economyTransaction.create.mockResolvedValueOnce({} as never);
    prismaMock.requestAction.create.mockResolvedValueOnce({} as never);

    await createRequest(7, {
      communityId: 1,
      title: 'Untitled',
      description: 'A description',
      type: 'Music',
      year: undefined,
      image: undefined,
      bounty: BigInt(110_000_000),
      artists: [5, 10]
    });

    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          artists: { create: [{ artistId: 5 }, { artistId: 10 }] }
        })
      })
    );
  });
});

describe('requests.unfillRequest', () => {
  it('throws AppError(500) when filled request has no fillerId', async () => {
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'filled',
      fillerId: null,
      bounties: []
    } as never);

    await expect(
      unfillRequest({ requestId: 1, actorId: 7, canModerateRequests: true })
    ).rejects.toThrow('Filled request has no fillerId');
  });

  it('claws back bounty from filler when bounties exist', async () => {
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.request.findUnique
      .mockResolvedValueOnce({
        id: 1,
        status: 'filled',
        fillerId: 42,
        bounties: [{ amount: BigInt(110_000_000) }]
      } as never)
      .mockResolvedValueOnce({
        id: 1,
        status: 'open',
        fillerId: null,
        bounties: [{ amount: BigInt(110_000_000) }]
      } as never);
    prismaMock.user.findUniqueOrThrow.mockResolvedValueOnce({
      consumed: BigInt(0),
      contributed: BigInt(110_000_000)
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({} as never);
    prismaMock.economyTransaction.create.mockResolvedValueOnce({} as never);
    prismaMock.request.update.mockResolvedValueOnce({} as never);
    prismaMock.requestAction.create.mockResolvedValueOnce({} as never);

    await unfillRequest({
      requestId: 1,
      actorId: 7,
      canModerateRequests: true
    });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({
          contributed: { decrement: BigInt(110_000_000) },
          ratio: expect.any(Number)
        })
      })
    );
  });
});

// ─── requests.serializeRequest ────────────────────────────────────────────────

describe('requests.serializeRequest', () => {
  const base = {
    id: 1,
    communityId: 1,
    userId: 7,
    title: 'Test',
    description: 'desc',
    type: 'Music' as const,
    year: null,
    image: null,
    status: 'open' as const,
    fillerId: null,
    filledAt: null,
    filledContributionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    voteCount: 0
  };

  it('sums bounties and serializes amounts to strings', () => {
    const makeBounty = (amount: bigint) => ({
      id: 1,
      requestId: 1,
      userId: 7,
      amount,
      createdAt: new Date()
    });
    const result = serializeRequest({
      ...base,
      bounties: [
        makeBounty(BigInt(110_000_000)),
        makeBounty(BigInt(50_000_000))
      ]
    });
    expect(result.totalBounty).toBe('160000000');
    expect(result.bounties![0].amount).toBe('110000000');
  });

  it('returns totalBounty "0" when no bounties', () => {
    const result = serializeRequest({ ...base, bounties: [] });
    expect(result.totalBounty).toBe('0');
  });
});

// ─── requests.listRequests ────────────────────────────────────────────────────

describe('requests.listRequests', () => {
  it('returns paginated requests with no filters', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 1,
        communityId: 1,
        userId: 7,
        title: 'Test',
        description: 'desc',
        type: 'Music',
        year: null,
        image: null,
        status: 'open',
        fillerId: null,
        filledAt: null,
        filledContributionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        voteCount: 0,
        bounties: []
      }
    ] as never);
    prismaMock.request.count.mockResolvedValueOnce(1);

    const result = await listRequests();

    expect(result.meta.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});

// ─── staffInbox.viewTicket ───────────────────────────────────────────────────────

describe('staffInbox.viewTicket', () => {
  it('returns not_found when ticket does not exist', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce(null);

    const result = await viewTicket(1, 7, false);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when non-staff accesses another user ticket', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1,
      userId: 99,
      isReadByUser: true,
      messages: []
    } as never);

    const result = await viewTicket(1, 7, false);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('marks ticket as read for non-staff user who owns it', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1,
      userId: 7,
      isReadByUser: false,
      user: {
        id: 7,
        username: 'testuser',
        avatar: null,
        isDonor: false,
        warned: null,
        donorRank: null
      },
      assignedUser: null,
      resolver: null,
      messages: []
    } as never);
    prismaMock.staffInboxConversation.update.mockResolvedValueOnce({} as never);

    const result = await viewTicket(1, 7, false);

    expect(result.ok).toBe(true);
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isReadByUser: true } })
    );
  });
});

// ─── staffInbox.assignTicket ──────────────────────────────────────────────────

describe('staffInbox.assignTicket', () => {
  it('returns not_found when ticket does not exist', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce(null);

    const result = await assignTicket(1, 5, 7);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('unassigns ticket without touching status', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1
    } as never);
    prismaMock.staffInboxConversation.update.mockResolvedValueOnce({} as never);

    const result = await assignTicket(1, null, 7);

    expect(result.ok).toBe(true);
    // Assignment must not reset conversation status (ADR-0001-aligned reconcile).
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedUserId: null } })
    );
  });

  it('assigns to a staff-permitted user and writes an audit row', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1
    } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 5,
      userRank: { permissions: { staff_inbox_manage: true } }
    } as never);
    prismaMock.staffInboxConversation.update.mockResolvedValueOnce({} as never);
    prismaMock.auditLog.create.mockResolvedValueOnce({} as never);

    const result = await assignTicket(1, 5, 7);

    expect(result.ok).toBe(true);
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedUserId: 5 } })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 7,
          action: 'staff_inbox.assign',
          targetId: 1
        })
      })
    );
  });

  it('returns assignee_not_found when assignee user does not exist', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1
    } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await assignTicket(1, 5, 7);

    expect(result).toEqual({ ok: false, reason: 'assignee_not_found' });
  });

  it('returns assignee_not_staff when assignee lacks the staff_inbox_manage permission', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValueOnce({
      id: 1
    } as never);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 5,
      userRank: { permissions: { download: true } }
    } as never);

    const result = await assignTicket(1, 5, 7);

    expect(result).toEqual({ ok: false, reason: 'assignee_not_staff' });
  });
});

// ─── staffInbox.bulkResolve ───────────────────────────────────────────────────

describe('staffInbox.bulkResolve', () => {
  it('returns resolved: 0 when all tickets are already resolved', async () => {
    prismaMock.staffInboxConversation.findMany.mockResolvedValueOnce([]);

    const result = await bulkResolve([1, 2, 3], 7);

    expect(result).toEqual({ ok: true, resolved: 0 });
    expect(prismaMock.staffInboxConversation.updateMany).not.toHaveBeenCalled();
  });

  it('resolves unresolved tickets, records the resolver, and audits', async () => {
    prismaMock.staffInboxConversation.findMany.mockResolvedValueOnce([
      { id: 1 },
      { id: 2 }
    ] as never);
    prismaMock.staffInboxConversation.updateMany.mockResolvedValueOnce({
      count: 2
    } as never);
    prismaMock.auditLog.create.mockResolvedValueOnce({} as never);

    const result = await bulkResolve([1, 2], 7);

    expect(result).toEqual({ ok: true, resolved: 2 });
    // Reconcile: bulk resolve must attribute the resolver (scoreboard credit).
    expect(prismaMock.staffInboxConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'Resolved', resolverId: 7 }
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 7,
          action: 'staff_inbox.bulk_resolve'
        })
      })
    );
  });
});

// ─── stats.getSystemStats ─────────────────────────────────────────────────────

import type * as StatsModule from './modules/stats';
const { getSystemStats } =
  jest.requireActual<typeof StatsModule>('./modules/stats');

describe('stats.getSystemStats', () => {
  it('aggregates counts and download totals', async () => {
    prismaMock.user.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(60);
    prismaMock.community.count.mockResolvedValueOnce(12);
    prismaMock.release.count.mockResolvedValueOnce(500);
    prismaMock.artist.count.mockResolvedValueOnce(200);
    prismaMock.blog.count.mockResolvedValueOnce(10);
    prismaMock.news.count.mockResolvedValueOnce(3);
    prismaMock.comment.count.mockResolvedValueOnce(400);
    prismaMock.contribution.count.mockResolvedValueOnce(1000);
    prismaMock.contribution.findMany.mockResolvedValueOnce([
      { _count: { consumers: 10 } },
      { _count: { consumers: 5 } }
    ] as never);
    prismaMock.siteSettings.upsert.mockResolvedValueOnce({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 5000,
      dismissedLaunchChecklist: [],
      updatedAt: new Date()
    } as never);

    const result = await getSystemStats();

    expect(result.maxUsers).toBe(5000);
    expect(result.totalUsers).toBe(100);
    expect(result.enabledUsers).toBe(80);
    expect(result.contributedLinkDownloads).toBe(15);
    expect(result.communities).toBe(12);
  });
});
