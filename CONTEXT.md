# Stellar API

A strict, type-safe REST API using Express, Prisma (PostgreSQL), and Zod. This service implements auto-generated OpenAPI documentation, production log streams, and strict string sanitization.

Stellar is a next-generation **community and content tracker** — an invite-only platform of Communities whose members contribute and consume hosted content (Contributions are Download URLs), with contribute/consume accounting, link-health, and a Community Reputation Score.

**Runtime Entry**: `src/index.ts` (Builds to `dist/index.js` via `tsc`)
**Dev Loop**: Driven by `nodemon` watching `src/**/*.ts` executing via `ts-node --esm`
**Database Engine**: Prisma ORM connected to PostgreSQL (`pg`)
**Observability**: Winston for application event streaming + Sentry for error tracing

## Language

**Contract Schema:**
A Zod definition containing extended metadata properties that explicitly generates structural API responses, request schemas, and auto-generated OpenApi documentation.
_Avoid_: validation rule, raw validation, types schema

**Data Client:**
The standalone exported instance of Prisma Client mapping directly to the underlying PostgreSQL connection lifecycle.
_Avoid_: pool client, database hook, db runner

**Sanitized Value**:
A user-provided string mutation processed through `isomorphic-dompurify` and `jsdom` to actively strip malicious HTML/XSS vectors before passing to a service block or database operation.
_Avoid_: clean string, checked text, escaped data

**Identity State**:
The post-middleware payload containing the decrypted JWT data decoded from incoming headers or `cookie-parser` cookies, systematically exposed inside `Express.Request.user`.
_Avoid_: active passport, logged-in session, user record

**Integration Database**:
The isolated, transactional test database targeting custom parameters from `.env.test` executed via `npm run test:integration` inside `jest`.
_Avoid_: live testing database, local test instance

## Relationships

- A **Contract Schema** directly structures incoming inputs and dictates the programmatic generation of the schema served by `swagger-ui-express`.
- An **Identity State** acts as an authorized gateway, validating if a request can access or mutate a specific database record via the **Data Client**.
- **Sanitized Values** must be extracted at the Controller layer using **Contract Schemas** before execution by domain services.

## Flagged Ambiguities

- **"Token Location"** was confusingly structured -- resolved: authentication accepts authorization header bearer tokens or implicit secure `cookie-parser` keys.
- **"Testing Data"** was causing conflicts -- resolved: unit tests utilize mock layers via `jest-mock-extended` and run in parallel via `maxWorkers: 50%`; integration routines strictly target the temporary **Integration Database** and run sequentially (`--runInBand`) to prevent concurrent DB writes.

## Repository Execution Guardrails

### 1. Database Operations & Lifecycles

- Any database state modification requires structural validation against its respective schema layer.
- Schema changes require pushing changes locally using `npm run db:migrate` and running code generation via `npm run db:generate`.
- Seed mock data exclusively through the localized engine script `npm run db:seed`.

### 2. Contract Schemas & Documentation (Zod to OpenAPI)

- Every public route path must bind directly to an registry mapping from `@asteasolutions/zod-to-openapi`.
- Never write standard YAML or JSON files for Swagger UI manually. Run `npm run openapi:export` to generate definitions straight from the application runtime source code.

```typescript
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

export const registry = new OpenAPIRegistry();
const RegisterBody = registry.register(
  'RegisterBody',
  z.object({
    username: z.string().min(1).max(32),
    email: z.string().email(),
    password: z.string().min(6),
    inviteKey: z.string().optional()
  })
);
```

### 3. Error Control & Telemtry Pipeline

- Operational exceptions must route directly out of controller scopes into Express middleware handlers to be serialized for the client.
- System crashes and unhandled exceptions are captured simultaneously across Winston data streams and remote Sentry scopes.

## AI Assistant Instructions

When generating, modifying, or refactoring code within this project, adhere strictly to these engineering constraints:

- **Strict Imports**: Ensure typing definitions capture global context parameters without fallback loops to typing defaults.
- **Sanitization Paths**: Ensure all text fields incoming from dynamic payloads go through the application string purification routine prior to persistence actions.
- **Test Isolation**: Do not pollute parallel test pipelines; write explicit test isolation using jest-mock-extended wrappers when writing atomic units.
