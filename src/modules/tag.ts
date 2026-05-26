import { prisma } from '../lib/prisma';

export const resolveTagName = async (name: string): Promise<string> => {
  const alias = await prisma.tagAlias.findUnique({
    where: { badTag: name },
    select: { goodTag: { select: { name: true } } }
  });
  return alias?.goodTag.name ?? name;
};

export const resolveTagNames = async (names: string[]): Promise<string[]> => {
  if (names.length === 0) return [];
  const aliases = await prisma.tagAlias.findMany({
    where: { badTag: { in: names } },
    select: { badTag: true, goodTag: { select: { name: true } } }
  });
  const aliasMap = new Map(aliases.map((a) => [a.badTag, a.goodTag.name]));
  return [...new Set(names.map((n) => aliasMap.get(n) ?? n))];
};
