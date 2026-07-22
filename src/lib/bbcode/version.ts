// Bump when the parser output or sanitize allowlist changes. It is part of the
// render-cache key, so a bump rotates every cached entry without a manual flush
// (ADR-0026-adjacent; see #398). Keep it a plain integer.
export const PARSER_VERSION = 2;
