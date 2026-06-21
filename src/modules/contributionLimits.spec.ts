import { ReleaseType } from '@prisma/client';
import { AppError } from '../lib/errors';
import {
  CONTRIBUTION_SIZE_CAPS,
  assertWithinSizeCap
} from './contributionLimits';

describe('CONTRIBUTION_SIZE_CAPS', () => {
  it('defines an explicit, individually-reasoned ceiling for every ReleaseType', () => {
    // Every enum member must have its own entry — no type silently shares
    // another category's number or falls through to a default.
    for (const type of Object.values(ReleaseType)) {
      expect(typeof CONTRIBUTION_SIZE_CAPS[type]).toBe('number');
      expect(CONTRIBUTION_SIZE_CAPS[type]).toBeGreaterThan(0);
    }
    expect(Object.keys(CONTRIBUTION_SIZE_CAPS).sort()).toEqual(
      Object.values(ReleaseType).sort()
    );
  });

  it('matches the agreed per-type ceilings', () => {
    expect(CONTRIBUTION_SIZE_CAPS).toEqual({
      Music: 20_000_000_000,
      Applications: 100_000_000_000,
      ELearningVideos: 50_000_000_000,
      Audiobooks: 10_000_000_000,
      Comedy: 10_000_000_000,
      Comics: 2_000_000_000,
      EBooks: 500_000_000
    });
  });
});

describe('assertWithinSizeCap', () => {
  it('passes a size under the type cap', () => {
    expect(() =>
      assertWithinSizeCap(ReleaseType.Music, 19_000_000_000)
    ).not.toThrow();
  });

  it('passes a size exactly at the cap (boundary is inclusive)', () => {
    expect(() =>
      assertWithinSizeCap(ReleaseType.Music, CONTRIBUTION_SIZE_CAPS.Music)
    ).not.toThrow();
  });

  it('rejects a size one byte over the cap with a 413', () => {
    try {
      assertWithinSizeCap(ReleaseType.Music, CONTRIBUTION_SIZE_CAPS.Music + 1);
      fail('expected assertWithinSizeCap to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(413);
      expect((err as AppError).message).toContain('Music');
    }
  });

  it('keys the ceiling on the release type — same size passes one type, fails another', () => {
    // 1 GB is fine for Applications (100 GB cap) but over the EBooks cap (500 MB).
    const oneGb = 1_000_000_000;
    expect(() =>
      assertWithinSizeCap(ReleaseType.Applications, oneGb)
    ).not.toThrow();
    expect(() => assertWithinSizeCap(ReleaseType.EBooks, oneGb)).toThrow(
      AppError
    );
  });

  it('treats an omitted size as valid (size is optional)', () => {
    expect(() =>
      assertWithinSizeCap(ReleaseType.Music, undefined)
    ).not.toThrow();
    expect(() => assertWithinSizeCap(ReleaseType.Music, null)).not.toThrow();
  });
});
