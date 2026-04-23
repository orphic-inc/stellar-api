import { Prisma } from '@prisma/client';

export const appendToJsonArray = <T>(
  existing: unknown,
  item: T
): Prisma.InputJsonValue =>
  [...(Array.isArray(existing) ? existing : []), item] as Prisma.InputJsonValue;

export const jsonObjectArray = (
  existing: unknown
): Array<Record<string, unknown>> =>
  Array.isArray(existing)
    ? existing.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
    : [];

export const removeFromJsonArrayAtIndex = (
  existing: unknown,
  index: number
): Prisma.InputJsonValue => {
  const items = Array.isArray(existing) ? [...existing] : [];
  items.splice(index, 1);
  return items as Prisma.InputJsonValue;
};
