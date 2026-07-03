import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import {
  makeAuthorRefRow,
  makeComment,
  makeCommentWithAuthor
} from './test/factories';

jest.mock('./modules/comment', () => ({
  deleteComment: jest.fn()
}));

import * as commentModule from './modules/comment';
const deleteCommentMock = (commentModule as jest.Mocked<typeof commentModule>)
  .deleteComment;

beforeEach(() => resetApiTestState());

// ─── GET /api/comments ────────────────────────────────────────────────────────

describe('GET /api/comments', () => {
  it('returns a paginated list of comments with no filters', async () => {
    prismaMock.comment.findMany.mockResolvedValue([
      makeCommentWithAuthor({ id: 12 })
    ] as never);
    prismaMock.comment.count.mockResolvedValue(1);

    const res = await request(app).get('/api/comments');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  // #231 — comment authors must carry the donor sign + warning sign so the
  // PostBox renders them anywhere comments appear, not just on the profile.
  it('returns authors as AuthorRef with donor and warning signs', async () => {
    prismaMock.comment.findMany.mockResolvedValue([
      makeCommentWithAuthor({
        id: 12,
        author: makeAuthorRefRow({
          isDonor: true,
          warned: new Date('2026-03-01T00:00:00.000Z'),
          donorRank: {
            expiresAt: null,
            donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' }
          }
        })
      })
    ] as never);
    prismaMock.comment.count.mockResolvedValue(1);

    const res = await request(app).get('/api/comments');

    expect(res.status).toBe(200);
    expect(res.body.data[0].author).toEqual({
      id: 7,
      username: 'testuser',
      avatar: null,
      isDonor: true,
      donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' },
      warned: '2026-03-01T00:00:00.000Z'
    });
  });

  it('filters by communities page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=communities&pageId=5');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'communities', communityId: 5 });
  });

  it('filters by artist page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=artist&pageId=3');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'artist', artistId: 3 });
  });

  it('filters by collages page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=collages&pageId=2');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'collages', collageId: 2 });
  });

  it('filters by contributions page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=contributions&pageId=1');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({
      page: 'contributions',
      contributionId: 1
    });
  });

  it('filters by requests page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=requests&pageId=4');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'requests', requestId: 4 });
  });

  it('filters by release page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=release&pageId=7');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'release', releaseId: 7 });
  });

  it('filters only by page when pageId is omitted', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?context=artist');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'artist', deletedAt: null });
    expect(call?.where).not.toHaveProperty('artistId');
  });

  it('returns 400 for an invalid page filter', async () => {
    const res = await request(app).get(
      '/api/comments?context=bad-page&pageId=1'
    );

    expect(res.status).toBe(400);
    expect(prismaMock.comment.findMany).not.toHaveBeenCalled();
  });
});

// ─── GET /api/comments/:id ────────────────────────────────────────────────────

describe('GET /api/comments/:id', () => {
  it('returns the comment when found', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeCommentWithAuthor({ id: 12 }) as never
    );

    const res = await request(app).get('/api/comments/12');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(12);
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/comments/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });

  it('returns 400 for a non-numeric comment id', async () => {
    const res = await request(app).get('/api/comments/nope');

    expect(res.status).toBe(400);
    expect(prismaMock.comment.findUnique).not.toHaveBeenCalled();
  });
});

// ─── POST /api/comments ───────────────────────────────────────────────────────

describe('POST /api/comments', () => {
  it('creates a comment and returns 201', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeCommentWithAuthor({ id: 20, communityId: 5 }) as never
    );

    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'Great community!',
      communityId: 5
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          page: 'communities',
          authorId: 7,
          communityId: 5
        })
      })
    );
  });

  it('persists release comments with the matching foreign key', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeCommentWithAuthor({ id: 21, page: 'release', releaseId: 9 }) as never
    );

    const res = await request(app).post('/api/comments').send({
      page: 'release',
      body: 'Excellent release.',
      releaseId: 9
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          page: 'release',
          releaseId: 9
        })
      })
    );
  });

  it('persists contribution comments with the matching foreign key', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({
        id: 22,
        page: 'contributions' as never,
        contributionId: 11
      }) as never
    );

    const res = await request(app).post('/api/comments').send({
      page: 'contributions',
      body: 'Helpful contribution.',
      contributionId: 11
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          page: 'contributions',
          contributionId: 11
        })
      })
    );
  });

  it('persists request comments with the matching foreign key', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({
        id: 23,
        page: 'requests' as never,
        requestId: 14
      }) as never
    );

    const res = await request(app).post('/api/comments').send({
      page: 'requests',
      body: 'Please fill this.',
      requestId: 14
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          page: 'requests',
          requestId: 14
        })
      })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities'
    });

    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('notifies comment subscribers on pages with subscription support', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({ id: 30, page: 'requests' as never, requestId: 14 }) as never
    );
    prismaMock.commentSubscription.findMany.mockResolvedValue([
      { userId: 20 },
      { userId: 21 },
      { userId: 7 } // auth user — should be excluded
    ] as never);

    const res = await request(app).post('/api/comments').send({
      page: 'requests',
      body: 'Nice.',
      requestId: 14
    });

    expect(res.status).toBe(201);
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 20, type: 'comment_sub' }),
          expect.objectContaining({ userId: 21, type: 'comment_sub' })
        ]),
        skipDuplicates: true
      })
    );
    const callData = (prismaMock.notification.createMany as jest.Mock).mock
      .calls[0][0].data as { userId: number }[];
    expect(callData.map((d) => d.userId)).not.toContain(7);
  });

  it('checks comment subscriptions for release page', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({ id: 31, page: 'release' as never, releaseId: 9 }) as never
    );
    prismaMock.commentSubscription.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/comments').send({
      page: 'release',
      body: 'Great.',
      releaseId: 9
    });

    expect(res.status).toBe(201);
    expect(prismaMock.commentSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { page: 'release', pageId: 9 } })
    );
  });

  it('emits forum_quote notifications when comment body contains a quote', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({ id: 40, page: 'requests' as never, requestId: 14 }) as never
    );
    prismaMock.commentSubscription.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 25 }] as never);

    const res = await request(app).post('/api/comments').send({
      page: 'requests',
      body: '[quote=bob]Great request[/quote] Seconded.',
      requestId: 14
    });

    expect(res.status).toBe(201);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          username: { in: ['bob'], mode: 'insensitive' },
          disabled: false
        })
      })
    );
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 25,
            type: 'forum_quote',
            page: 'requests',
            pageId: 14
          })
        ])
      })
    );
  });

  it('does not emit forum_quote when no quotes are present in comment', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeComment({ id: 41, page: 'artist' as never, artistId: 3 }) as never
    );
    prismaMock.commentSubscription.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/comments').send({
      page: 'artist',
      body: 'Just a plain comment.',
      artistId: 3
    });

    expect(res.status).toBe(201);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('emits forum_quote for newly introduced quotes on comment edit', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({
        id: 42,
        authorId: 7,
        page: 'collages' as never,
        collageId: 5,
        body: 'Original comment'
      }) as never
    );
    prismaMock.comment.update.mockResolvedValue(
      makeComment({ id: 42 }) as never
    );
    prismaMock.user.findMany.mockResolvedValue([{ id: 30 }] as never);

    const res = await request(app).put('/api/comments/42').send({
      body: '[quote=carol]nice collage[/quote] Agreed.'
    });

    expect(res.status).toBe(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          username: { in: ['carol'], mode: 'insensitive' }
        })
      })
    );
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 30, type: 'forum_quote' })
        ])
      })
    );
  });
});

// ─── PUT /api/comments/:id ────────────────────────────────────────────────────

describe('PUT /api/comments/:id', () => {
  it('updates a comment authored by the current user', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    prismaMock.comment.update.mockResolvedValue(
      makeComment({ id: 12, body: 'Updated body' }) as never
    );

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Updated body' });

    expect(res.status).toBe(200);
    expect(prismaMock.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({ body: 'Updated body', editedUserId: 7 })
      })
    );
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/comments/99')
      .send({ body: 'Update' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });

  it('returns 403 when the user does not own the comment', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Tamper' });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });

  it('returns 400 for a non-numeric comment id', async () => {
    const res = await request(app).put('/api/comments/nope').send({
      body: 'Updated body'
    });

    expect(res.status).toBe(400);
    expect(prismaMock.comment.findUnique).not.toHaveBeenCalled();
  });
});

// ─── DELETE /api/comments/:id ─────────────────────────────────────────────────

describe('DELETE /api/comments/:id', () => {
  it('deletes a comment owned by the current user', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    deleteCommentMock.mockResolvedValue([] as never);

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(deleteCommentMock).toHaveBeenCalledWith(12, 7, false);
  });

  it("allows a moderator to delete another user's comment", async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ reports_manage: true })
    );
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );
    deleteCommentMock.mockResolvedValue([] as never);

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(deleteCommentMock).toHaveBeenCalledWith(12, 7, true);
  });

  it('returns 403 for non-owner without moderator permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/comments/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });

  it('returns 400 for a non-numeric comment id', async () => {
    const res = await request(app).delete('/api/comments/nope');

    expect(res.status).toBe(400);
    expect(prismaMock.comment.findUnique).not.toHaveBeenCalled();
  });
});

// ─── POST /api/comments — keyCount invariant ─────────────────────────────────

describe('POST /api/comments — exactly-one target id invariant', () => {
  it('returns 400 when no target id is provided (keyCount = 0)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'test'
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when multiple target ids are provided (keyCount > 1)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'contributions',
      body: 'test',
      contributionId: 1,
      requestId: 2
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});

// ─── POST /api/comments — cross-page ID validation ───────────────────────────
// Each test sends exactly one foreign-key ID but for a mismatched page type,
// exercising the per-page superRefine branches (lines 46, 54, 62, 73, 81
// in schemas/comment.ts) that are skipped when keyCount !== 1.

describe('POST /api/comments — cross-page ID mismatch validation', () => {
  it('returns 400 when page=communities but communityId is missing (artistId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'test',
      artistId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when page=artist but artistId is missing (communityId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'artist',
      body: 'test',
      communityId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when page=collages but collageId is missing (artistId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'collages',
      body: 'test',
      artistId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when page=contributions but contributionId is missing (communityId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'contributions',
      body: 'test',
      communityId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when page=requests but requestId is missing (artistId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'requests',
      body: 'test',
      artistId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when page=release but releaseId is missing (communityId provided)', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'release',
      body: 'test',
      communityId: 5
    });
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});
