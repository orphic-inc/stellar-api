/**
 * devTools/seedRandom.ts
 *
 * Deterministic seeded PRNG using the mulberry32 algorithm.
 * No external dependencies — produces identical sequences for the same seed.
 */

// ─── Core PRNG ────────────────────────────────────────────────────────────────

/**
 * Mulberry32 PRNG. Returns a function that produces [0, 1) floats.
 * Each call advances the state deterministically.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── SeedContext ──────────────────────────────────────────────────────────────

/**
 * A seeded random context that can produce deterministic sub-contexts
 * per section, ensuring generators don't interfere with each other's sequences.
 */
export class SeedContext {
  private rng: () => number;
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  /** Returns next float in [0, 1) */
  next(): number {
    return this.rng();
  }

  /**
   * Creates a deterministic sub-context for a named section.
   * The sub-context has its own independent state derived from
   * the parent seed + a stable hash of the tag string.
   */
  fork(tag: string): SeedContext {
    // Stable hash of tag string mixed with parent seed
    let h = this.seed ^ 0xdeadbeef;
    for (let i = 0; i < tag.length; i++) {
      h = Math.imul(h ^ tag.charCodeAt(i), 0x9e3779b9);
      h = ((h << 13) | (h >>> 19)) ^ (h << 5);
    }
    return new SeedContext((h >>> 0) + 1); // +1 avoids seed=0
  }
}

// ─── Distribution Helpers ─────────────────────────────────────────────────────

/** Pick a random element from an array */
export function pick<T>(arr: readonly T[], ctx: SeedContext): T {
  return arr[Math.floor(ctx.next() * arr.length)];
}

/** Pick n unique random elements from an array (without replacement) */
export function pickN<T>(arr: readonly T[], n: number, ctx: SeedContext): T[] {
  const copy = [...arr];
  const result: T[] = [];
  const limit = Math.min(n, copy.length);
  for (let i = 0; i < limit; i++) {
    const idx = Math.floor(ctx.next() * (copy.length - i));
    result.push(copy[idx]);
    copy[idx] = copy[copy.length - 1 - i];
  }
  return result;
}

/** Fisher-Yates shuffle — returns a new shuffled array */
export function shuffle<T>(arr: readonly T[], ctx: SeedContext): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Random integer in [min, max] inclusive */
export function randInt(min: number, max: number, ctx: SeedContext): number {
  return min + Math.floor(ctx.next() * (max - min + 1));
}

/** Random boolean with given probability of true */
export function randBool(probability: number, ctx: SeedContext): boolean {
  return ctx.next() < probability;
}

/**
 * Power-law distributed index in [0, n).
 * exponent > 1: most values cluster near 0 (low index = low activity).
 * Useful for activity distributions where most users are inactive
 * and few are highly active.
 */
export function powerLaw(
  n: number,
  exponent: number,
  ctx: SeedContext
): number {
  // Use inverse transform sampling on a power-law CDF
  const u = ctx.next();
  return Math.floor(n * Math.pow(u, exponent));
}

/**
 * Returns a random date between start and end dates.
 */
export function randDate(start: Date, end: Date, ctx: SeedContext): Date {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return new Date(startMs + Math.floor(ctx.next() * (endMs - startMs)));
}

/**
 * Returns a date N days before now, randomized within a window.
 */
export function daysAgo(
  minDays: number,
  maxDays: number,
  ctx: SeedContext
): Date {
  const days = randInt(minDays, maxDays, ctx);
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/**
 * Biased element picker: elements with higher weight are more likely to be selected.
 * weights array must have same length as arr.
 */
export function weightedPick<T>(
  arr: readonly T[],
  weights: readonly number[],
  ctx: SeedContext
): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = ctx.next() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
