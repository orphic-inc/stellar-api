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
import { getUserRankQuotas } from '../lib/userRankAccess';
import { cssValidate, formatCssViolations } from '../lib/cssValidate';
import { scoreStylesheetSelection } from './stylesheetScore';
import type { AuthorStylesheetInput } from '../schemas/stylesheet';
import type { PageParams } from '../lib/pagination';

/**
 * Create a new AuthorStylesheet for the calling author (many per author),
 * gated by the author's rank-configured registry-space count (#146,
 * `UserRank.authorStylesheetLimit`, mirroring `personalCollageLimit`'s
 * 0-means-unlimited shape).
 *
 * The quota is resolved across the author's **primary and secondary ranks**
 * (ADR-0032 §4). This previously read the primary rank alone while `toAuthUser`
 * advertised the maximum across both, so PRD-03's donor-added slots — which are
 * modelled as a secondary rank — read as granted and enforced as absent: a donor
 * was shown 5, allowed 3, and refused with a number they had never been told
 * (#369). `getUserRankQuotas` is now the single resolver behind both.
 *
 * `source` is validated at store-time and stored **verbatim** (ADR-0031 §5): the
 * boundary rejects an unsafe sheet rather than cleaning it, so the bytes on disk
 * are the bytes the author submitted. See `lib/cssValidate.ts`.
 */
export const createAuthorStylesheet = async (
  authorId: number,
  input: AuthorStylesheetInput
) => {
  const { authorStylesheetLimit } = await getUserRankQuotas(authorId);
  if (authorStylesheetLimit !== null) {
    const count = await prisma.authorStylesheet.count({
      // Withdrawn sheets do not occupy a registry space — this filter is what
      // makes the quota reclaimable rather than a one-way ratchet (#368).
      where: { authorId, deletedAt: null }
    });
    if (count >= authorStylesheetLimit) {
      throw new AppError(
        400,
        `Author stylesheet limit reached (${authorStylesheetLimit})`
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
 * Edit a sheet in place (ADR-0032 §2, #368). Author-scoped.
 *
 * Edits propagate live to every adopter, which is intended rather than
 * tolerated: sheet identity is a stable id while content varies, and #350
 * settled that adoption tracks the author's edits. It is also why the `/css`
 * route sets `Cache-Control: no-cache` — a comment that has claimed sheets are
 * "mutable (authors edit in place)" since before any edit path existed.
 *
 * Same validator call site as create. `assertSafeSource` was written expecting
 * this ("shared by create and any future edit path"), so an edit cannot smuggle
 * past the ADR-0031 boundary that a create is held to.
 */
export const updateAuthorStylesheet = async (
  id: number,
  authorId: number,
  input: AuthorStylesheetInput
) => {
  const existing = await prisma.authorStylesheet.findFirst({
    where: { id, deletedAt: null },
    select: { authorId: true }
  });
  if (!existing) throw new AppError(404, 'Author stylesheet not found');
  if (existing.authorId !== authorId)
    throw new AppError(403, 'Not your stylesheet');

  assertSafeSource(input.source);

  return prisma.authorStylesheet.update({
    where: { id },
    data: { name: input.name, source: input.source }
  });
};

/**
 * Withdraw a sheet (ADR-0032 §3, #368). Author-scoped, soft.
 *
 * Frees the author's registry space — the quota #146 enforces had no release
 * path, making it a one-way ratchet — while leaving existing adopters' sites
 * untouched, because `getAuthorStylesheetCss` alone ignores `deletedAt`.
 *
 * The CRS ledger is deliberately untouched. `CRS_STYLESHEET_ADOPTION` rows stay:
 * those adoptions were earned, and PRD-03's marginal tier table already eases an
 * author's score down as live counts fall rather than re-rating history.
 *
 * Idempotent by filter: withdrawing an already-withdrawn sheet 404s rather than
 * moving `deletedAt`, so the timestamp records the first withdrawal.
 */
export const deleteAuthorStylesheet = async (id: number, authorId: number) => {
  const existing = await prisma.authorStylesheet.findFirst({
    where: { id, deletedAt: null },
    select: { authorId: true }
  });
  if (!existing) throw new AppError(404, 'Author stylesheet not found');
  if (existing.authorId !== authorId)
    throw new AppError(403, 'Not your stylesheet');

  await prisma.authorStylesheet.update({
    where: { id },
    data: { deletedAt: new Date() }
  });
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
      where: { authorId, deletedAt: null },
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
    // Same filter on the total: the paginated envelope's `total` is what a UI
    // renders as "n of N spaces used", so it must agree with the quota count.
    prisma.authorStylesheet.count({ where: { authorId, deletedAt: null } })
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
  prisma.authorStylesheet.findFirst({ where: { id, deletedAt: null } });

/**
 * Read just the sanitized `source` for CSS delivery (ADR-0024 §1). Kept lean —
 * the `/css` route serves the body verbatim as `text/css`, so nothing else is
 * selected. Null if the sheet does not exist.
 *
 * **Deliberately does NOT filter `deletedAt`** — the one read path that does not
 * (#368, ADR-0032 §3). This asymmetry is the entire reason withdrawal is a soft
 * delete: an author freeing a registry space must not change the site under
 * someone who adopted their sheet. Every other path hides a withdrawn sheet;
 * this one keeps serving its bytes to whoever already points at it.
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
  // Withdrawn sheets cannot be newly adopted (#368) — existing adopters keep
  // rendering via `/css`, but the sheet is gone from every discovery path, so
  // arriving here for one means a stale id rather than a live choice.
  const sheet = await prisma.authorStylesheet.findFirst({
    where: { id: stylesheetId, deletedAt: null }
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
