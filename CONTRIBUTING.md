# Contributing to Stellar API

Welcome! We appreciate your interest in contributing to Stellar API. To keep the codebase healthy, modular, and maintainable, please adhere to the following architectural guidelines.

## Code Standards

### Error Handling
Always use the custom `AppError` class when intentionally throwing errors that should be surfaced to the client. This ensures the global error handler (`src/app.ts`) responds with the correct HTTP status code instead of a generic 500 error.

**Do:**
```typescript
import { AppError } from '../lib/errors';
throw new AppError(404, 'User not found');
```

**Don't:**
```typescript
throw new Error('User not found'); // Results in a 500 status code
```

### Input Validation & Type Safety
We use **Zod** for schema validation. Do not manually cast variables using `as T`. Instead, use the built-in `parsedBody`, `parsedParams`, and `parsedQuery` helpers which infer types securely based on your schema.

**Do:**
```typescript
import { parsedBody } from '../../middleware/validate';
const { email, password } = parsedBody<LoginInput>(res);
```

### Separation of Concerns
- **Routes (`src/routes`)**: Controllers should only handle HTTP mappings, response formatting, and status codes.
- **Modules/Services (`src/modules`)**: All database operations and business logic must be housed here, decoupled from Express.

### Database Operations (Prisma)
- Avoid manual string manipulation or raw SQL unless absolutely necessary.
- **Soft Deletes**: Always rely on Prisma soft-delete patterns or extensions rather than manually filtering `deletedAt: null` across all queries.

## Testing
We utilize Jest and Supertest.
- New endpoints must be accompanied by integration tests in `src/integration`.
- Utilize the `apiTestHarness` and `dbHelpers` to cleanly stub out the database or test user context during integration tests.

## Submitting Pull Requests
1. Ensure `npm run build` and `npm run test` pass.
2. If you altered API endpoints, ensure you run `npm run openapi:export` and commit the updated `openapi.json`.
3. Provide a clear description of the changes in your PR and link to any relevant issues.
