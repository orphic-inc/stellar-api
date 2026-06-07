/**
 * Contribution.sizeInBytes is BIGINT in Postgres — file sizes routinely exceed
 * INT4 (2 GiB). The API contract still exposes it as a JS number (exact below
 * 2^53 ≈ 9 PB), not the string our global BigInt.toJSON (src/app.ts) would
 * otherwise emit. Cast at every read site that returns it to a client.
 */
export const sizeBytesToNumber = (
  v: bigint | number | null | undefined
): number | null => (v == null ? null : Number(v));
