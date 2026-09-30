/**
 * The constraint guards on stylesheet.ts writes (#596, ADR-0048). Each is
 * proved by failing its write with the code it translates, or by the state a
 * concurrent writer leaves behind.
 */
import { Prisma } from '@prisma/client';

const mockPrisma = {
  stylesheet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn()
  },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  }
}));

import {
  createStylesheet,
  deleteStylesheet,
  updateStylesheet
} from './stylesheet';

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const refusal = (statusCode: number, message: string) =>
  expect.objectContaining({ statusCode, message });

const NAME_TAKEN = refusal(409, 'A stylesheet with that name already exists');
const CONFLICT = refusal(
  409,
  'Another stylesheet change conflicted with this one; retry'
);

const sheet = {
  name: 'dusk',
  description: 'd',
  cssUrl: null,
  isDefault: false
};

beforeEach(() => {
  mockPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
  );
});

describe('createStylesheet', () => {
  it('answers 409 for a taken name, before any write', async () => {
    mockPrisma.stylesheet.findUnique.mockResolvedValue({ id: 2 });
    await expect(createStylesheet(sheet)).rejects.toEqual(NAME_TAKEN);
    expect(mockPrisma.stylesheet.create).not.toHaveBeenCalled();
  });

  it('answers 409 when a concurrent write takes the name or the default', async () => {
    mockPrisma.stylesheet.findUnique.mockResolvedValue(null);
    mockPrisma.stylesheet.create.mockRejectedValue(prismaErr('P2002'));
    await expect(createStylesheet(sheet)).rejects.toEqual(CONFLICT);
    await expect(
      createStylesheet({ ...sheet, isDefault: true })
    ).rejects.toEqual(CONFLICT);
  });
});

describe('updateStylesheet', () => {
  beforeEach(() => {
    // The first read is the row itself; the second is the name check.
    mockPrisma.stylesheet.findUnique.mockImplementation(
      ({ where }: { where: { id?: number; name?: string } }) =>
        Promise.resolve(
          where.id === 1
            ? { id: 1, isDefault: false }
            : where.name === 'taken'
              ? { id: 2 }
              : where.name === 'mine'
                ? { id: 1 }
                : null
        )
    );
  });

  it('answers 409 for a rename onto another stylesheet’s name', async () => {
    await expect(updateStylesheet(1, { name: 'taken' })).rejects.toEqual(
      NAME_TAKEN
    );
    expect(mockPrisma.stylesheet.update).not.toHaveBeenCalled();
  });

  it('lets a stylesheet keep its own name', async () => {
    mockPrisma.stylesheet.update.mockResolvedValue({ id: 1 });
    await expect(updateStylesheet(1, { name: 'mine' })).resolves.toEqual({
      id: 1
    });
  });

  it('answers 409 when a concurrent write takes the name', async () => {
    mockPrisma.stylesheet.update.mockRejectedValue(prismaErr('P2002'));
    await expect(updateStylesheet(1, { name: 'free' })).rejects.toEqual(
      CONFLICT
    );
  });

  it('answers 404 when a concurrent delete won', async () => {
    mockPrisma.stylesheet.update.mockRejectedValue(prismaErr('P2025'));
    await expect(updateStylesheet(1, { description: 'x' })).rejects.toEqual(
      refusal(404, 'Stylesheet not found')
    );
  });
});

describe('deleteStylesheet, when the row changed after its read', () => {
  beforeEach(() => {
    mockPrisma.stylesheet.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('answers 404 when a concurrent delete won', async () => {
    mockPrisma.stylesheet.findUnique
      .mockResolvedValueOnce({ id: 1, isDefault: false })
      .mockResolvedValueOnce(null);
    await expect(deleteStylesheet(1)).rejects.toEqual(
      refusal(404, 'Stylesheet not found')
    );
  });

  // The invariant #376 protects: the registry always has a default.
  it('refuses when the row was made the default in between', async () => {
    mockPrisma.stylesheet.findUnique
      .mockResolvedValueOnce({ id: 1, isDefault: false })
      .mockResolvedValueOnce({ id: 1, isDefault: true });
    await expect(deleteStylesheet(1)).rejects.toEqual(
      refusal(400, 'Cannot delete the default stylesheet')
    );
    expect(mockPrisma.stylesheet.deleteMany).toHaveBeenCalledWith({
      where: { id: 1, isDefault: false }
    });
  });
});
