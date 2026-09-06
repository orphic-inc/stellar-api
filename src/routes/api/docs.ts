import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from '../../lib/openapi';
import { collectRoutes } from '../../lib/expressRoutes';
import { isContractRoute, stripApi } from '../../lib/openapiCompleteness';
import type { Application } from 'express';

let cachedDoc: ReturnType<typeof buildOpenApiDocument> | null = null;

// `req.app` IS the mounted app, so the routes come from the same place the
// export script reads them — which is what keeps the served spec and the
// committed openapi.json identical. Importing `createApp` here instead would be
// circular (app -> docs -> app).
const getDoc = (app: Application) => {
  if (!cachedDoc) {
    const routes = collectRoutes(app).filter(isContractRoute).map(stripApi);
    cachedDoc = buildOpenApiDocument(routes);
  }
  return cachedDoc;
};

// GET /api/docs/json — raw OpenAPI spec
export const specRouter = Router();
specRouter.get('/', ((req: Request, res: Response) => {
  res.json(getDoc(req.app));
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
