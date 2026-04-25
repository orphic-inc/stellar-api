import { Request, Response } from 'express';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

export const parsePage = (req: Request): PageParams => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE)
  );
  return { page, limit, skip: (page - 1) * limit };
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
