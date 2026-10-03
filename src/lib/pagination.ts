import { z } from 'zod';
import type { Response } from 'express';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Spread into any Zod query schema to add validated, bounded page/limit fields.
 * Use with validateQuery() then read back with pageOf(handle.read(res)).
 */
export const paginationBase = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(DEFAULT_PAGE_SIZE)
};

/**
 * PageParams from a validated query: `pageOf(listQuery.read(res))` (#234).
 * Pure, so it has no pairing of its own to get wrong; the handle checked it.
 * A schema that does not spread `paginationBase` has no `page` or `limit`, and
 * the call stops compiling.
 */
export const pageOf = ({
  page,
  limit
}: {
  page: number;
  limit: number;
}): PageParams => ({ page, limit, skip: (page - 1) * limit });

/**
 * Superseded by `pageOf` (#234), and deleted once every route reads through a
 * handle. Derive PageParams from a query already validated by validateQuery().
 * The calling route MUST have run validateQuery() with a schema that
 * spreads paginationBase before calling this.
 */
export const parsedPage = (res: Response): PageParams => {
  const q = res.locals.parsedQuery as { page: number; limit: number };
  return { page: q.page, limit: q.limit, skip: (q.page - 1) * q.limit };
};

export const paginatedResponse = (
  res: Response,
  data: unknown[],
  total: number,
  { page, limit }: PageParams
): void => {
  res.json({
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
};
