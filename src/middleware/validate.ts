import { Request, Response, NextFunction, RequestHandler } from 'express';
import { type ZodTypeAny as ZodSchema } from 'zod';
import { markGate } from '../lib/routeGate';

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

/**
 * Each validator STAMPS ITSELF as a `validation` gate (#567).
 *
 * The stamp goes on the handler the factory returns, not on the factory, so
 * every mounted validator carries it without a route having to remember. That
 * is the same reason `requirePermission` stamps inside its own body: the
 * returned function is an anonymous arrow, so there is no `fn.name` for the
 * contract to match on, and matching names would break the moment one is
 * renamed or wrapped.
 *
 * The target says WHICH part of the request the schema covers, which is what
 * the derived description reads. Before this, 170 of the 269 routes running a
 * validator declared no `400` at all, and the 79 that did said `Validation
 * error` without saying what was invalid.
 */
export const validate = (schema: ZodSchema): RequestHandler =>
  markGate(
    (req: Request, res: Response, next: NextFunction) => {
      const data = validationError(res, schema, req.body);
      if (!data) return;
      req.body = data;
      res.locals.parsedBody = data;
      next();
    },
    'validation',
    undefined,
    undefined,
    ['body']
  );

export const validateQuery = (schema: ZodSchema): RequestHandler =>
  markGate(
    (req: Request, res: Response, next: NextFunction) => {
      const data = validationError(res, schema, req.query);
      if (!data) return;
      Object.assign(req.query, data);
      res.locals.parsedQuery = data;
      next();
    },
    'validation',
    undefined,
    undefined,
    ['query']
  );

export const validateParams = (schema: ZodSchema): RequestHandler =>
  markGate(
    (req: Request, res: Response, next: NextFunction) => {
      const data = validationError(res, schema, req.params);
      if (!data) return;
      Object.assign(req.params, data);
      res.locals.parsedParams = data;
      next();
    },
    'validation',
    undefined,
    undefined,
    ['params']
  );

export function parsedParams<T>(res: Response): T {
  return res.locals.parsedParams as T;
}

export function parsedQuery<T>(res: Response): T {
  return res.locals.parsedQuery as T;
}

export function parsedBody<T>(res: Response): T {
  return res.locals.parsedBody as T;
}
