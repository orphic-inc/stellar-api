import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema } from 'zod';

const VALIDATION_ERROR_MESSAGE = 'Validation failed';

const validationError = (res: Response, schema: ZodSchema, data: unknown) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({
      msg: VALIDATION_ERROR_MESSAGE,
      errors: result.error.flatten().fieldErrors
    });
    return null;
  }
  return result.data;
};

export const validate =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const data = validationError(res, schema, req.body);
    if (!data) return;
    req.body = data;
    res.locals.parsedBody = data;
    next();
  };

export const validateQuery =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const data = validationError(res, schema, req.query);
    if (!data) return;
    Object.assign(req.query, data);
    res.locals.parsedQuery = data;
    next();
  };

export const validateParams =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const data = validationError(res, schema, req.params);
    if (!data) return;
    Object.assign(req.params, data);
    res.locals.parsedParams = data;
    next();
  };

export function parsedParams<T>(res: Response): T {
  return res.locals.parsedParams as T;
}

export function parsedQuery<T>(res: Response): T {
  return res.locals.parsedQuery as T;
}

export function parsedBody<T>(res: Response): T {
  return res.locals.parsedBody as T;
}
