/**
 * AuthorStylesheet — a user-authored stylesheet saved for others to adopt
 * (PRD-03, descent target #4a / #118).
 *
 * One per author: a member has at most one AuthorStylesheet, so saving is an
 * upsert keyed on the author. This is the keystone the shipped
 * `scoreStylesheetSelection` (#84) hooks onto — #119 adds adoption, #120 scores
 * it. No CRS wiring lives here yet.
 */
import { prisma } from '../lib/prisma';
import type { AuthorStylesheetInput } from '../schemas/stylesheet';

/** Save (create or replace) the calling author's single AuthorStylesheet. */
export const upsertAuthorStylesheet = (
  authorId: number,
  input: AuthorStylesheetInput
) =>
  prisma.authorStylesheet.upsert({
    where: { authorId },
    create: { authorId, name: input.name, source: input.source },
    update: { name: input.name, source: input.source }
  });

/** Read an author's stylesheet, or null if they have not saved one. */
export const getAuthorStylesheet = (authorId: number) =>
  prisma.authorStylesheet.findUnique({ where: { authorId } });
