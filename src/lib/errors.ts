export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * An error that belongs to a specific request field rather than the request as a
 * whole, so the global handler renders `{ errors: { field: [msgs] } }` instead
 * of `{ msg }` — the same envelope `validate()` emits for Zod failures.
 *
 * This exists because some field-level rejections cannot happen in `validate()`:
 * the CSS boundary (ADR-0031 §5) needs to report several violations against
 * `source`, each with a location, and it lives in a module the route delegates
 * to. Throwing this keeps the route thin while still producing the shape a form
 * can render (ADR-0032 §6).
 */
export class FieldError extends AppError {
  constructor(
    public readonly fieldErrors: Record<string, string[]>,
    message = 'Validation failed',
    statusCode = 400
  ) {
    super(statusCode, message);
    this.name = 'FieldError';
  }
}
