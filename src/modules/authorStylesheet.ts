/**
 * AuthorStylesheet — user-authored stylesheets saved for others to adopt
 * (PRD-03, descent target #4).
 *
 * A member may author MANY stylesheets (cardinality fixed in #119; the
 * rank-gated count limit is deferred). Adoption is the keystone the shipped
 * `scoreStylesheetSelection` (#84) hooks onto:
 *   - #118 save:  create / list / read an author's sheets.
 *   - #119 adopt: a viewer points their Site Stylesheet slot
 *     (`UserSettings.activeAuthorStylesheetId`) at a chosen sheet, idempotently.
 *   - #120 score: a non-self adoption records the durable (adopter, author) pair
 *     once in the `CRS_*` event ledger (ADR-0007); the author's read-time
 *     stylesheet CRS dimension counts those pairs.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { sanitizeStylesheetSource } from '../lib/cssSanitize';
import { scoreStylesheetSelection } from './stylesheetScore';
import type { AuthorStylesheetInput } from '../schemas/stylesheet';

/**
 * Create a new AuthorStylesheet for the calling author (many per author).
 *
 * `source` is sanitized at store-time (ADR-0003): the injected artifact is kept
 * safe in the database, not just at render. See `lib/cssSanitize.ts`.
 */
export const createAuthorStylesheet = (
  authorId: number,
  input: AuthorStylesheetInput
) =>
  prisma.authorStylesheet.create({
    data: {
      authorId,
      name: input.name,
      source: sanitizeStylesheetSource(input.source)
    }
  });

/** List an author's stylesheets, oldest first. */
export const listAuthorStylesheets = (authorId: number) =>
  prisma.authorStylesheet.findMany({
    where: { authorId },
    orderBy: { createdAt: 'asc' }
  });

/** Read a single AuthorStylesheet by its id, or null if it does not exist. */
export const getAuthorStylesheetById = (id: number) =>
  prisma.authorStylesheet.findUnique({ where: { id } });

export interface AdoptionResult {
  /** The adopted stylesheet (now in the adopter's Site Stylesheet slot). */
  authorStylesheet: Awaited<ReturnType<typeof getAuthorStylesheetById>>;
  /** Whether this adoption recorded a new (adopter, author) CRS ledger event. */
  scored: boolean;
}

/**
 * Adopt a stylesheet into the adopter's Site Stylesheet slot, and — for a
 * non-self adoption — accrue to the author (#120).
 *
 * The pure scorer decides recipient: a self-adoption returns `author: null`
 * (using your own sheet renders but earns nothing — anti-farm), so no ledger
 * row is written. A cross-user adoption records the (adopter, author) pair once
 * (deduped); re-adopting the same author's sheets never double-credits, which
 * is exactly the once-per-distinct-pair rule the controlled vector needs.
 *
 * The Site-slot pointer update and the CRS ledger write are deliberately NOT
 * in one transaction: changing your theme is the user-facing effect and must
 * not be rolled back or blocked by a hiccup in the (advisory) author accrual.
 * The dedup is enforced atomically by a partial unique index on
 * (userId, actorUserId) WHERE reason = 'CRS_STYLESHEET_ADOPTION', so concurrent
 * double-adopts insert-and-catch P2002 rather than both crediting the author.
 */
export const adoptAuthorStylesheet = async (
  adopterId: number,
  stylesheetId: number
): Promise<AdoptionResult> => {
  const sheet = await prisma.authorStylesheet.findUnique({
    where: { id: stylesheetId }
  });
  if (!sheet) throw new AppError(404, 'Author stylesheet not found');

  // #119 — point the adopter's Site Stylesheet slot at this sheet (idempotent).
  // Done unconditionally and independently of the ledger write below.
  await prisma.user.update({
    where: { id: adopterId },
    data: { userSettings: { update: { activeAuthorStylesheetId: sheet.id } } }
  });

  const authorAccrual = scoreStylesheetSelection({
    userId: adopterId,
    origin: { kind: 'author', authorId: sheet.authorId }
  }).author;
  // Self-adoption (author: null) renders but earns nothing — no ledger row.
  if (!authorAccrual) return { authorStylesheet: sheet, scored: false };

  // #120 — record the durable adoption event, once per (adopter, author).
  // Insert-and-catch: the partial unique index turns a duplicate (the same
  // adopter re-adopting this author, or a concurrent double-click) into P2002,
  // which we treat as "already scored".
  try {
    await prisma.economyTransaction.create({
      data: {
        userId: authorAccrual.userId, // CRS recipient = the author
        actorUserId: adopterId, // who adopted
        amount: 1n, // one adoption event; CRS magnitude lives in the read-time scorer
        reason: 'CRS_STYLESHEET_ADOPTION',
        contextType: 'AuthorStylesheet',
        contextId: sheet.id
      }
    });
    return { authorStylesheet: sheet, scored: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { authorStylesheet: sheet, scored: false };
    }
    throw err;
  }
};
