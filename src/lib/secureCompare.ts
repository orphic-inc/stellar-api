import crypto from 'crypto';

/** Constant-time string equality that also tolerates length mismatch. */
export const secureCompare = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};
