import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema } from 'zod';

const validationError = (res: Response, schema: ZodSchema, data: unknown) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({ errors: result.error.flatten().fieldErrors });
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
    next();
  };

export const validateQuery =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const data = validationError(res, schema, req.query);
    if (!data) return;
    Object.assign(req.query, data);
    next();
  };

export const validateParams =
  (schema: ZodSchema): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const data = validationError(res, schema, req.params);
    if (!data) return;
    Object.assign(req.params, data);
    next();
  };
