import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildOpenApiDocument } from '../lib/openapi';

const doc = buildOpenApiDocument();
const outPath = resolve(__dirname, '../../openapi.json');
writeFileSync(outPath, JSON.stringify(doc, null, 2));
console.log(`OpenAPI spec written to ${outPath}`);
