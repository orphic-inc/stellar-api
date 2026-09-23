import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { makeComment } from './test/factories';

// #703: `deleteComment` only stamps `deletedAt` and keeps the body, so PUT and
// DELETE on /comments/:id must treat a soft-deleted comment as missing — at
// the read and again at the write, which is what closes the race. Split from
// comments.spec.ts to keep that file's size where it was.

jest.mock('./modules/comment', () => ({
  deleteComment: jest.fn(),
  canSeeCommentThread: jest.fn(),
  canSeeThreadOf: jest.fn()
}));

import * as commentModule from './modules/comment';
const mockedComment = commentModule as jest.Mocked<typeof commentModule>;
const deleteCommentMock = mockedComment.deleteComment;

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

beforeEach(() => {
  resetApiTestState();
  mockedComment.canSeeThreadOf.mockResolvedValue(true);
});

describe('PUT /api/comments/:id — soft-deleted comments (#703)', () => {
  // #703: `deleteComment` keeps the body, so without the filter the author
  // could edit a deleted comment — and quote-notify people about it.
  it('never finds a soft-deleted comment', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Resurrected' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
    expect(prismaMock.comment.findUnique).toHaveBeenCalledWith({
      where: { id: 12, deletedAt: null }
    });
    expect(prismaMock.comment.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the comment is deleted between the read and the edit', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    prismaMock.comment.update.mockRejectedValue(prismaErr('P2025'));

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Too late' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });
});

describe('DELETE /api/comments/:id — soft-deleted comments (#703)', () => {
  // #703: a second delete re-stamped `deletedAt` and wrote a second audit row.
  it('never finds a soft-deleted comment', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
    expect(prismaMock.comment.findUnique).toHaveBeenCalledWith({
      where: { id: 12, deletedAt: null }
    });
    expect(deleteCommentMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the comment is deleted between the read and the delete', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    deleteCommentMock.mockRejectedValue(prismaErr('P2025'));

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });
});
