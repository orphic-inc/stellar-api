/**
 * The constraint guards on staffInbox.ts writes (#596, ADR-0048). Each is
 * proved by failing its write with the code it translates. The sites not
 * guarded are recorded as internally derived; noHardDelete.spec.ts holds the
 * fact those reasons rest on.
 */
import { Prisma } from '@prisma/client';

const mockPrisma = {
  staffInboxResponse: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  }
};

jest.mock('../lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  }
}));

import { deleteResponse, updateResponse } from './staffInbox';

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const notFound = { ok: false, reason: 'not_found' };

beforeEach(() => {
  // The pre-read finds the response; another staff member deletes it before
  // the write lands.
  mockPrisma.staffInboxResponse.findUnique.mockResolvedValue({ id: 3 });
});

describe('a canned response deleted between the read and the write', () => {
  it('updateResponse answers the read’s own not_found', async () => {
    mockPrisma.staffInboxResponse.update.mockRejectedValue(prismaErr('P2025'));
    await expect(updateResponse(3, { name: 'n' })).resolves.toEqual(notFound);
  });

  it('deleteResponse answers the read’s own not_found', async () => {
    mockPrisma.staffInboxResponse.delete.mockRejectedValue(prismaErr('P2025'));
    await expect(deleteResponse(3)).resolves.toEqual(notFound);
  });

  // The guard translates P2025 only; anything else is still a server error.
  it.each([
    ['updateResponse', () => updateResponse(3, { name: 'n' })],
    ['deleteResponse', () => deleteResponse(3)]
  ])('%s rethrows any other error', async (_name, call) => {
    const other = prismaErr('P2002');
    mockPrisma.staffInboxResponse.update.mockRejectedValue(other);
    mockPrisma.staffInboxResponse.delete.mockRejectedValue(other);
    await expect(call()).rejects.toBe(other);
  });
});
