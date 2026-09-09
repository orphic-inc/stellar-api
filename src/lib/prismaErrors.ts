import { Prisma } from '@prisma/client';
import { AppError } from './errors';

/**
 * Translate a Prisma constraint violation into an `AppError` (#564).
 *
 * WHY THIS EXISTS, given the idiom already worked:
 *
 * The global handler is `err.statusCode ?? 500` and maps no Prisma code, so
 * every write that can violate a constraint needs a catch that translates one.
 * Written out longhand that catch is about ten lines, and it has to sit
 * **lexically inside its handler** — `prismaGuardCoverage` detects guards
 * structurally, so a catch hidden behind a call is invisible to it and the site
 * reports as unguarded.
 *
 * Ten lines per site is enough to push a handler past Codacy's per-function
 * limits: #591 had to extract four helpers out of `collages.ts` to make room for
 * five guards. That is the tension this resolves. The `try` stays in the
 * handler; only the translation moves.
 *
 * RETURN TYPE IS `never`, AND THAT IS LOAD-BEARING. It lets TypeScript see that
 * the catch always exits, so the common shape still type-checks:
 *
 *     let updated;
 *     try {
 *       updated = await prisma.collage.update({ ... });
 *     } catch (err) {
 *       translatePrismaError(err, { P2025: [404, 'Collage not found'] });
 *     }
 *     res.json(updated);           // `updated` is definitely assigned
 *
 * It is a `function` declaration rather than an arrow const on purpose: TypeScript
 * only applies never-returning control-flow analysis to a call whose target has
 * an explicit `never` return, and a const arrow needs a type annotation on the
 * variable to get the same treatment.
 *
 * ANYTHING UNMAPPED IS RETHROWN. A guard that swallowed the rest would turn a
 * genuine fault into a confident 4xx, which is worse than the 500 it replaced.
 */

/** The codes a handler can meaningfully translate. */
export type PrismaErrorCode = 'P2002' | 'P2003' | 'P2025';

/** `{ P2025: [404, 'Collage not found'] }` — code → [status, message]. */
export type PrismaErrorMap = Partial<
  Record<PrismaErrorCode, readonly [number, string]>
>;

export function translatePrismaError(err: unknown, map: PrismaErrorMap): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = map[err.code as PrismaErrorCode];
    if (mapped) throw new AppError(mapped[0], mapped[1]);
  }
  throw err;
}
