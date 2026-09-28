import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { authHandler } from '../modules/asyncHandler';
import { addImageSrcs } from '../modules/imageSrc';
import { registerWriteImages } from '../modules/remoteImage';
import { parsedBody } from './validate';

/**
 * Give every JSON response its image `*Src` siblings (#737, ADR-0051): the
 * address a browser may load for each `avatar`, `image`, `customIcon` and
 * `secondAvatar`, which is never a remote URL. See `modules/imageSrc.ts`.
 *
 * It wraps `res.json` rather than asking each of the 82 operations that return
 * an image to resolve its own, so a surface added later cannot forget to. The
 * lookup never throws: on failure every remote image resolves to null.
 */
export const resolveImageSrcs = (
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  const send = res.json.bind(res);
  res.json = ((body?: unknown) => {
    addImageSrcs(body)
      .then(() => send(body))
      .catch(next);
    return res;
  }) as Response['json'];
  next();
};

/**
 * Register the remote images a validated body's image `fields` hold, before
 * the handler writes, so a write past the daily ceiling is refused with 429
 * whole (#737, ADR-0051).
 *
 * Mount it after the route's gate and `validate`. It runs before the handler's
 * own checks, so use it only where the gate is the whole authorization;
 * otherwise register inside the handler, after its checks.
 */
export const registerBodyImages = (...fields: string[]): RequestHandler =>
  authHandler(async (req, res, next) => {
    const body = parsedBody<Record<string, unknown>>(res) ?? {};
    const values = fields.map((field) =>
      typeof body[field] === 'string' ? (body[field] as string) : null
    );
    await registerWriteImages({ fields: values }, req.user.id);
    next();
  });
