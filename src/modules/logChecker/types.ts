/**
 * Log checker — shared types.
 *
 * A faithful TypeScript port of the legacy EAC/XLD log-scoring logic. The score
 * is "what % of a perfect rip this log proves": 100 means a verified-perfect rip
 * (a FLAC contribution carrying such a log earns the Perfect quality grade).
 *
 * The drive read-offset check from the legacy code is intentionally NOT ported:
 * it depended on a `drives` offset table that the original itself marked TODO and
 * never populated. Its absence only ever removed points, so omitting it cannot
 * inflate a score above what the legacy checker would award for the same log.
 */
export type Ripper = 'EAC' | 'XLD';

/** One scoring finding. `points` is what it subtracted (0 for FAIL/override notes). */
export interface Deduction {
  message: string;
  points: number;
}

export interface LogCheckResult {
  /** Detected ripper, or null when the log isn't a recognized EAC/XLD log. */
  ripper: Ripper | null;
  /** EAC: a version float as string ("1.0"); XLD: the 8-digit build date. */
  version: string | null;
  /** 0–100. */
  score: number;
  /** score === 100. */
  isPerfect: boolean;
  deductions: Deduction[];
}

/** Normalize a raw line the way both legacy parsers do: trim + collapse runs of whitespace. */
export function normalizeLine(line: string): string {
  return line.replace(/\s\s+/g, ' ').trim();
}
