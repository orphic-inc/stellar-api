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
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { scoreStylesheetSelection } from './stylesheetScore';
import type { AuthorStylesheetInput } from '../schemas/stylesheet';

/** Create a new AuthorStylesheet for the calling author (many per author). */
export const createAuthorStylesheet = (
  authorId: number,
  input: AuthorStylesheetInput
) =>
  prisma.authorStylesheet.create({
    data: { authorId, name: input.name, source: input.source }
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
 */
export const adoptAuthorStylesheet = async (
  adopterId: number,
  stylesheetId: number
): Promise<AdoptionResult> => {
  const sheet = await prisma.authorStylesheet.findUnique({
    where: { id: stylesheetId }
  });
  if (!sheet) throw new AppError(404, 'Author stylesheet not found');

  const accrual = scoreStylesheetSelection({
    userId: adopterId,
    origin: { kind: 'author', authorId: sheet.authorId }
  });
  const authorAccrual = accrual.author;

  const scored = await prisma.$transaction(async (tx) => {
    // #119 — point the adopter's Site Stylesheet slot at this sheet (idempotent).
    await tx.user.update({
      where: { id: adopterId },
      data: { userSettings: { update: { activeAuthorStylesheetId: sheet.id } } }
    });

    // #120 — record the durable adoption event, once per (adopter, author).
    if (!authorAccrual) return false;
    const existing = await tx.economyTransaction.findFirst({
      where: {
        userId: authorAccrual.userId,
        actorUserId: adopterId,
        reason: 'CRS_STYLESHEET_ADOPTION'
      },
      select: { id: true }
    });
    if (existing) return false;
    await tx.economyTransaction.create({
      data: {
        userId: authorAccrual.userId, // CRS recipient = the author
        actorUserId: adopterId, // who adopted
        amount: 1n, // one adoption event; CRS magnitude lives in the read-time scorer
        reason: 'CRS_STYLESHEET_ADOPTION',
        contextType: 'AuthorStylesheet',
        contextId: sheet.id
      }
    });
    return true;
  });

  return { authorStylesheet: sheet, scored };
};
