import {
  SeedContext,
  pick,
  pickN,
  shuffle,
  randInt,
  randBool,
  powerLaw
} from './seedRandom';

describe('SeedContext', () => {
  it('produces identical sequences for the same seed', () => {
    const ctx1 = new SeedContext(42);
    const ctx2 = new SeedContext(42);
    for (let i = 0; i < 100; i++) {
      expect(ctx1.next()).toBe(ctx2.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const ctx1 = new SeedContext(42);
    const ctx2 = new SeedContext(43);
    const seq1 = Array.from({ length: 20 }, () => ctx1.next());
    const seq2 = Array.from({ length: 20 }, () => ctx2.next());
    expect(seq1).not.toEqual(seq2);
  });

  it('produces values in [0, 1)', () => {
    const ctx = new SeedContext(1);
    for (let i = 0; i < 1000; i++) {
      const v = ctx.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('fork produces deterministic sub-contexts', () => {
    const root1 = new SeedContext(100);
    const root2 = new SeedContext(100);
    const fork1 = root1.fork('users');
    const fork2 = root2.fork('users');
    for (let i = 0; i < 50; i++) {
      expect(fork1.next()).toBe(fork2.next());
    }
  });

  it('fork produces different sub-contexts for different tags', () => {
    const root = new SeedContext(100);
    const a = root.fork('users');
    const b = root.fork('communities');
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('different fork tags from same root produce non-overlapping sequences', () => {
    const root = new SeedContext(55);
    const forks = ['alpha', 'beta', 'gamma', 'delta'].map((t) => root.fork(t));
    const sequences = forks.map((f) =>
      Array.from({ length: 10 }, () => f.next())
    );
    for (let i = 0; i < sequences.length; i++) {
      for (let j = i + 1; j < sequences.length; j++) {
        expect(sequences[i]).not.toEqual(sequences[j]);
      }
    }
  });
});

describe('pick', () => {
  it('always returns an element from the array', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const ctx = new SeedContext(1);
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(pick(arr, ctx));
    }
  });

  it('is deterministic with same seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const ctx1 = new SeedContext(7);
    const ctx2 = new SeedContext(7);
    for (let i = 0; i < 50; i++) {
      expect(pick(arr, ctx1)).toBe(pick(arr, ctx2));
    }
  });
});

describe('pickN', () => {
  it('returns exactly n unique elements', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ctx = new SeedContext(11);
    const result = pickN(arr, 5, ctx);
    expect(result).toHaveLength(5);
    expect(new Set(result).size).toBe(5);
    result.forEach((v) => expect(arr).toContain(v));
  });

  it('clamps to array length when n > arr.length', () => {
    const arr = [1, 2, 3];
    const ctx = new SeedContext(3);
    const result = pickN(arr, 100, ctx);
    expect(result).toHaveLength(3);
  });
});

describe('shuffle', () => {
  it('returns same elements in different order', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ctx = new SeedContext(99);
    const result = shuffle(arr, ctx);
    expect(result.sort((a, b) => a - b)).toEqual(arr);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    const ctx = new SeedContext(2);
    shuffle(arr, ctx);
    expect(arr).toEqual(original);
  });
});

describe('randInt', () => {
  it('always returns integer in [min, max]', () => {
    const ctx = new SeedContext(5);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(10, 20, ctx);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('randBool', () => {
  it('returns true with approximately the given probability', () => {
    const ctx = new SeedContext(3);
    let trueCount = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      if (randBool(0.3, ctx)) trueCount++;
    }
    const ratio = trueCount / n;
    // Allow ±5% variance
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it('always returns false when probability is 0', () => {
    const ctx = new SeedContext(1);
    for (let i = 0; i < 100; i++) {
      expect(randBool(0, ctx)).toBe(false);
    }
  });

  it('always returns true when probability is 1', () => {
    const ctx = new SeedContext(1);
    for (let i = 0; i < 100; i++) {
      expect(randBool(1, ctx)).toBe(true);
    }
  });
});

describe('powerLaw', () => {
  it('returns values in [0, n)', () => {
    const ctx = new SeedContext(42);
    for (let i = 0; i < 1000; i++) {
      const v = powerLaw(100, 2, ctx);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it('skews toward lower values with exponent > 1', () => {
    const ctx = new SeedContext(7);
    const values: number[] = [];
    for (let i = 0; i < 10000; i++) {
      values.push(powerLaw(100, 3, ctx));
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // Mean should be well below 50 for exponent=3
    expect(mean).toBeLessThan(30);
  });
});
