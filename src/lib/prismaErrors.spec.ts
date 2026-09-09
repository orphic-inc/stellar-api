import { Prisma } from '@prisma/client';
import { AppError } from './errors';
import { translatePrismaError } from './prismaErrors';

const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

describe('translatePrismaError', () => {
  it('turns a mapped code into an AppError with that status and message', () => {
    expect(() =>
      translatePrismaError(prismaErr('P2025'), {
        P2025: [404, 'Collage not found']
      })
    ).toThrow(new AppError(404, 'Collage not found'));
  });

  it('picks the entry matching the code, not the first one', () => {
    let thrown: unknown;
    try {
      translatePrismaError(prismaErr('P2003'), {
        P2002: [409, 'duplicate'],
        P2003: [400, 'dangling reference']
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(400);
    expect((thrown as AppError).message).toBe('dangling reference');
  });

  it('RETHROWS a Prisma code the caller did not map', () => {
    // A guard that swallowed the rest would turn a genuine fault into a
    // confident 4xx, which is worse than the 500 it replaced.
    const err = prismaErr('P2025');
    expect(() => translatePrismaError(err, { P2002: [409, 'nope'] })).toThrow(
      err
    );
  });

  it('RETHROWS an error that is not a Prisma error at all', () => {
    const err = new Error('connection lost');
    expect(() => translatePrismaError(err, { P2025: [404, 'x'] })).toThrow(err);
  });

  it('rethrows rather than returning, even with an empty map', () => {
    const err = prismaErr('P2002');
    expect(() => translatePrismaError(err, {})).toThrow(err);
  });

  it('never returns, so a value assigned in the try is definitely assigned', () => {
    // The `never` return type is what makes the common handler shape compile:
    // TypeScript sees the catch always exits. This asserts the runtime half of
    // that contract — the function cannot fall through.
    let assigned: string | undefined;
    const run = () => {
      try {
        assigned = 'from try';
        throw prismaErr('P2025');
      } catch (err) {
        translatePrismaError(err, { P2025: [404, 'gone'] });
      }
    };
    expect(run).toThrow(AppError);
    expect(assigned).toBe('from try');
  });
});
