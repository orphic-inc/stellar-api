import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, type ZodTypeAny as ZodSchema } from 'zod';
import { markGate } from '../lib/routeGate';

const VALIDATION_ERROR_MESSAGE = 'Validation failed';

const validationError = <S extends ZodSchema>(
  res: Response,
  schema: S,
  data: unknown
): z.infer<S> | null => {
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

type RequestPart = 'body' | 'query' | 'params';

/**
 * A mounted validator that also reads back what it validated (#234).
 *
 * It is the middleware itself, so a route mounts it exactly as before, and
 * `read(res)` returns the parsed data typed from the schema. There is no `<T>`
 * to choose, so the type cannot drift from the schema it names.
 *
 * Each handle writes under a symbol of its own, so `read` also proves the
 * pairing: a handler reading a handle its route never mounted throws, rather
 * than receiving `undefined` typed as the schema. One handle may be mounted on
 * any number of routes; each request sees only what its own layers wrote.
 */
export type ValidatorHandle<S extends ZodSchema> = RequestHandler & {
  read(res: Response): z.infer<S>;
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
const validator = <S extends ZodSchema>(
  schema: S,
  part: RequestPart,
  store: (req: Request, res: Response, data: z.infer<S>) => void
): ValidatorHandle<S> => {
  const key = Symbol(`validated ${part}`);
  const handler = markGate(
    (req: Request, res: Response, next: NextFunction) => {
      const data = validationError(res, schema, req[part]);
      if (!data) return;
      store(req, res, data);
      res.locals[key as unknown as string] = data;
      next();
    },
    'validation',
    undefined,
    undefined,
    [part]
  );
  return Object.assign(handler, {
    read(res: Response): z.infer<S> {
      const locals = res.locals as Record<symbol, unknown>;
      if (!(key in locals)) {
        throw new Error(
          `read() of a ${part} validator this route did not mount (#234)`
        );
      }
      return locals[key] as z.infer<S>;
    }
  });
};

// `res.locals.parsed*` stay written until every route reads through a handle
// (#234); `parsedBody` and its siblings below still read them.
export const validate = <S extends ZodSchema>(schema: S) =>
  validator(schema, 'body', (req, res, data) => {
    req.body = data;
    res.locals.parsedBody = data;
  });

export const validateQuery = <S extends ZodSchema>(schema: S) =>
  validator(schema, 'query', (req, res, data) => {
    Object.assign(req.query, data);
    res.locals.parsedQuery = data;
  });

export const validateParams = <S extends ZodSchema>(schema: S) =>
  validator(schema, 'params', (req, res, data) => {
    Object.assign(req.params, data);
    res.locals.parsedParams = data;
  });

export function parsedParams<T>(res: Response): T {
  return res.locals.parsedParams as T;
}

export function parsedQuery<T>(res: Response): T {
  return res.locals.parsedQuery as T;
}

export function parsedBody<T>(res: Response): T {
  return res.locals.parsedBody as T;
}
