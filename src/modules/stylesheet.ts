import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

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
  cssUrl: string;
  isDefault: boolean;
}) => {
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
    cssUrl: string;
    isDefault: boolean;
  }>
) => {
  const existing = await prisma.stylesheet.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Stylesheet not found');

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

// ─── AuthorStylesheet (PRD-03 #4a) ────────────────────────────────────────────
// User-owned, named stylesheets saved for others to adopt. No CRS wiring yet —
// the adopt → scoreStylesheetSelection accrual hook is descent-target #4c (#120).

export const createAuthorStylesheet = async (
  authorId: number,
  data: { name: string; description: string; source: string }
) => {
  const existing = await prisma.authorStylesheet.findUnique({
    where: { authorId_name: { authorId, name: data.name } }
  });
  if (existing)
    throw new AppError(409, 'You already have a stylesheet with that name');
  return prisma.authorStylesheet.create({ data: { authorId, ...data } });
};

export const getAuthorStylesheets = async (authorId: number) =>
  prisma.authorStylesheet.findMany({
    where: { authorId },
    orderBy: { createdAt: 'asc' }
  });
