/**
 * Unit tests for deleteComment's lost race (#838). Prisma is mocked; the
 * database behaviour is in comments.integration.ts.
 */
import { Prisma } from '@prisma/client';

jest.mock('../lib/prisma', () => ({
  prisma: {
    comment: { update: () => ({}) },
    auditLog: { create: () => ({}) },
    $transaction: jest.fn()
  }
}));

import { prisma } from '../lib/prisma';
import { deleteComment } from './comment';

const transaction = prisma.$transaction as unknown as jest.Mock;

describe('deleteComment', () => {
  it('answers 404 when another delete got there first', async () => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test'
      })
    );
    await expect(deleteComment(12, 7, false)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Comment not found'
    });
  });

  it('rethrows any other error', async () => {
    transaction.mockRejectedValue(new Error('connection lost'));
    await expect(deleteComment(12, 7, false)).rejects.toThrow(
      'connection lost'
    );
  });
});
