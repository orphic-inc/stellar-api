import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { authorStylesheetIdFromCssUrl } from './stylesheetRegistry';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The second half of the #375 write-path guard. `schemas/stylesheet.ts` proves a
 * delivery target is well-formed; only a DB can prove it resolves.
 *
 * Both halves are needed. A syntactically perfect target naming an
 * `AuthorStylesheet` that does not exist produces exactly the failure ADR-0024
 * set out to end: the row lands in the picker, `/css` 404s, and the member picks
 * a theme that renders nothing. Shape validation alone would have moved the dead
 * entry rather than removed it.
 *
 * `undefined` is "leave unchanged" on update and is not a target to check — as
 * distinct from `null`, which is the legal no-delivery arm.
 */
const assertDeliveryTargetResolves = async (
  cssUrl: string | null | undefined
): Promise<void> => {
  if (cssUrl === undefined || cssUrl === null) return;

  const authorStylesheetId = authorStylesheetIdFromCssUrl(cssUrl);
  // Unreachable through the routes — validate() runs the regex first — but this
  // is also the module's own contract, and createStylesheet is callable directly.
  if (authorStylesheetId === null)
    throw new AppError(400, 'CSS URL is not a /css delivery target');

  const target = await prisma.authorStylesheet.findUnique({
    where: { id: authorStylesheetId },
    select: { id: true }
  });
  if (!target)
    throw new AppError(
      400,
      `CSS URL names authored stylesheet ${authorStylesheetId}, which does not exist`
    );
};

export const getDefaultStylesheetName = async (tx?: Tx): Promise<string> => {
  const db = tx ?? prisma;
  const row = await db.stylesheet.findFirst({
    where: { isDefault: true },
    select: { name: true }
  });
  return row?.name ?? 'sublime';
};

export const getStylesheetStats = async () => {
  const [stylesheets, grouped] = await Promise.all([
    prisma.stylesheet.findMany({ select: { id: true, name: true } }),
    prisma.userSettings.groupBy({
      by: ['siteAppearance'],
      _count: { siteAppearance: true }
    })
  ]);
  const countMap = Object.fromEntries(
    grouped.map((g) => [g.siteAppearance, g._count.siteAppearance])
  );
  return stylesheets.map((s) => ({
    id: s.id,
    name: s.name,
    userCount: countMap[s.name] ?? 0
  }));
};

export const createStylesheet = async (data: {
  name: string;
  description: string;
  cssUrl: string | null;
  isDefault: boolean;
}) => {
  await assertDeliveryTargetResolves(data.cssUrl);

  if (data.isDefault) {
    return prisma.$transaction(async (tx) => {
      await tx.stylesheet.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
      return tx.stylesheet.create({ data });
    });
  }
  return prisma.stylesheet.create({ data });
};

export const updateStylesheet = async (
  id: number,
  data: Partial<{
    name: string;
    description: string;
    cssUrl: string | null;
    isDefault: boolean;
  }>
) => {
  const existing = await prisma.stylesheet.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Stylesheet not found');

  await assertDeliveryTargetResolves(data.cssUrl);

  if (data.isDefault) {
    return prisma.$transaction(async (tx) => {
      await tx.stylesheet.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
      return tx.stylesheet.update({ where: { id }, data });
    });
  }
  return prisma.stylesheet.update({ where: { id }, data });
};

export const deleteStylesheet = async (id: number) => {
  const existing = await prisma.stylesheet.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Stylesheet not found');
  if (existing.isDefault)
    throw new AppError(400, 'Cannot delete the default stylesheet');
  await prisma.stylesheet.delete({ where: { id } });
};
