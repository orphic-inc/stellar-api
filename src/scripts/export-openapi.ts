import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildOpenApiDocument } from '../lib/openapi';
import { createApp } from '../app';
import { collectRoutes } from '../lib/expressRoutes';
import { isContractRoute, stripApi } from '../lib/openapiCompleteness';

// The routes are required: `security` is derived from their gates (#520), so a
// document cannot be produced without them.
const routes = collectRoutes(createApp()).filter(isContractRoute).map(stripApi);
const doc = buildOpenApiDocument(routes);
const outPath = resolve(__dirname, '../../openapi.json');
writeFileSync(outPath, JSON.stringify(doc, null, 2));
console.log(`OpenAPI spec written to ${outPath}`);
