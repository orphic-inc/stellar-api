import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from '../../lib/openapi';

let cachedDoc: ReturnType<typeof buildOpenApiDocument> | null = null;
const getDoc = () => {
  if (!cachedDoc) cachedDoc = buildOpenApiDocument();
  return cachedDoc;
};

// GET /api/docs/json — raw OpenAPI spec
export const specRouter = Router();
specRouter.get('/', ((_req: Request, res: Response) => {
  res.json(getDoc());
}) as unknown as import('express').RequestHandler);

// GET /api/docs — Swagger UI (must be mounted separately from specRouter)
export const uiRouter = Router();
uiRouter.use(swaggerUi.serve);
uiRouter.get(
  '/',
  swaggerUi.setup(undefined, {
    swaggerOptions: { url: '/api/docs/json' }
  }) as unknown as import('express').RequestHandler
);
