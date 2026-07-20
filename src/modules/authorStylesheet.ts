/**
 * AuthorStylesheet — user-authored stylesheets saved for others to adopt
 * (PRD-03, descent target #4).
 *
 * A member may author MANY stylesheets (cardinality fixed in #119). Adoption
 * is the keystone the shipped `scoreStylesheetSelection` (#84) hooks onto:
 *   - #118 save:  create / list / read an author's sheets.
 *   - #119 adopt: a viewer points their Site Stylesheet slot
 *     (`UserSettings.activeAuthorStylesheetId`) at a chosen sheet, idempotently.
 *   - #120 score: a non-self adoption records the durable (adopter, author) pair
 *     once in the `CRS_*` event ledger (ADR-0007); the author's read-time
 *     stylesheet CRS dimension counts those pairs.
 *   - #146 list pagination + rank-gated count limit (registry spaces, PRD-03).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, FieldError } from '../lib/errors';
import { cssValidate, formatCssViolations } from '../lib/cssValidate';
import { scoreStylesheetSelection } from './stylesheetScore';
import type { AuthorStylesheetInput } from '../schemas/stylesheet';
import type { PageParams } from '../lib/pagination';

/**
 * Create a new AuthorStylesheet for the calling author (many per author),
 * gated by the author's rank-configured registry-space count (#146,
 * `UserRank.authorStylesheetLimit`, mirroring `personalCollageLimit`'s
 * 0-means-unlimited shape). `userRankId` is the caller's primary rank —
 * passed in rather than re-derived here, same scope as the collage-limit
 * precedent (secondary ranks are not consulted).
 *
 * `source` is validated at store-time and stored **verbatim** (ADR-0031 §5): the
 * boundary rejects an unsafe sheet rather than cleaning it, so the bytes on disk
 * are the bytes the author submitted. See `lib/cssValidate.ts`.
 */
export const createAuthorStylesheet = async (
  authorId: number,
  userRankId: number,
  input: AuthorStylesheetInput
) => {
  const rank = await prisma.userRank.findUnique({
    where: { id: userRankId },
    select: { authorStylesheetLimit: true }
  });
  if (rank && rank.authorStylesheetLimit > 0) {
    const count = await prisma.authorStylesheet.count({
      where: { authorId }
    });
    if (count >= rank.authorStylesheetLimit) {
      throw new AppError(
        400,
        `Author stylesheet limit reached (${rank.authorStylesheetLimit})`
      );
    }
  }

  assertSafeSource(input.source);

  return prisma.authorStylesheet.create({
    data: { authorId, name: input.name, source: input.source }
  });
};

/**
 * Reject a sheet that violates the ADR-0031 §3 boundary, reporting every
 * violation at once against the `source` field.
 *
 * Fail-fast at the call site rather than cleaning in place: a silently stripped
 * `url()` is a theme whose images vanish with nothing explaining why, and the
 * strip is what corrupted escaped identifiers (#340). Shared by create and any
 * future edit path, which is the third call site ADR-0031 §5 did not anticipate.
 */
export const assertSafeSource = (source: string): void => {
  const violations = cssValidate(source);
  if (violations.length > 0) {
    throw new FieldError(
      { source: formatCssViolations(violations) },
      'Stylesheet rejected'
    );
  }
};

/**
 * List an author's stylesheets, oldest first, paginated (#146) — **metadata
 * only** (ADR-0024 §1). `source` never rides a list payload; it is delivered
 * as `text/css` through the per-id `/css` route so there is exactly one path
 * a stored sheet leaves by.
 */
export const listAuthorStylesheets = (authorId: number, pg: PageParams) =>
  Promise.all([
    prisma.authorStylesheet.findMany({
      where: { authorId },
      orderBy: { createdAt: 'asc' },
      skip: pg.skip,
      take: pg.limit,
      select: {
        id: true,
        authorId: true,
        name: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.authorStylesheet.count({ where: { authorId } })
  ]);

/**
 * Read a single AuthorStylesheet by its id, or null if it does not exist.
 * Returns `source` — this is the edit-path read (ADR-0024 §1), not the browser
 * delivery path.
 *
 * NOT ownership-scoped, deliberately: any authenticated member can read any
 * sheet's source here, and the sibling `/css` route serves the same bytes because
 * an adopter's browser must be able to fetch another member's sheet. Authored
 * stylesheets carry no confidentiality expectation (ADR-0024, 2026-07-19
 * amendment) — an earlier "author + staff" framing described a control that never
 * shipped and cannot be enforced without breaking adoption.
 */
export const getAuthorStylesheetById = (id: number) =>
  prisma.authorStylesheet.findUnique({ where: { id } });

/**
 * Read just the sanitized `source` for CSS delivery (ADR-0024 §1). Kept lean —
 * the `/css` route serves the body verbatim as `text/css`, so nothing else is
 * selected. Null if the sheet does not exist.
 */
export const getAuthorStylesheetCss = (id: number) =>
  prisma.authorStylesheet.findUnique({
    where: { id },
    select: { source: true }
  });

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
