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
 * Use with validateQuery() then read back with parsedPage(res).
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
 * Derive PageParams from a query already validated by validateQuery().
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
