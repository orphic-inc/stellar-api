import { LinkHealthStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

const GiB = BigInt(1024 ** 3);

interface Bracket {
  upTo: bigint | null;
  maxRequired: number;
  minRequired: number;
  label: string;
}

const BRACKETS: Bracket[] = [
  { upTo: 5n * GiB, maxRequired: 0.0, minRequired: 0.0, label: '0–5 GiB' },
  { upTo: 10n * GiB, maxRequired: 0.15, minRequired: 0.0, label: '5–10 GiB' },
  { upTo: 20n * GiB, maxRequired: 0.2, minRequired: 0.0, label: '10–20 GiB' },
  { upTo: 30n * GiB, maxRequired: 0.3, minRequired: 0.05, label: '20–30 GiB' },
  { upTo: 40n * GiB, maxRequired: 0.4, minRequired: 0.1, label: '30–40 GiB' },
  { upTo: 50n * GiB, maxRequired: 0.5, minRequired: 0.2, label: '40–50 GiB' },
  { upTo: 60n * GiB, maxRequired: 0.6, minRequired: 0.3, label: '50–60 GiB' },
  { upTo: 80n * GiB, maxRequired: 0.6, minRequired: 0.4, label: '60–80 GiB' },
  { upTo: 100n * GiB, maxRequired: 0.6, minRequired: 0.5, label: '80–100 GiB' },
  { upTo: null, maxRequired: 0.6, minRequired: 0.6, label: '100+ GiB' }
];

export const computeRatio = (contributed: bigint, consumed: bigint): number => {
  if (consumed === 0n) return 1.0;
  return Number(contributed) / Number(consumed);
};

export const getConsumptionBracket = (
  consumedBytes: bigint
): { maxRequired: number; minRequired: number; label: string } => {
  for (const b of BRACKETS) {
    if (b.upTo === null || consumedBytes < b.upTo) {
      return {
        maxRequired: b.maxRequired,
        minRequired: b.minRequired,
        label: b.label
      };
    }
  }
  // Unreachable; last bracket has upTo: null
  return { maxRequired: 0.6, minRequired: 0.6, label: '100+ GiB' };
};

export const computeRequiredRatio = (
  consumedBytes: bigint,
  eligibleContributionBytes: bigint
): number => {
  const { maxRequired, minRequired } = getConsumptionBracket(consumedBytes);
  if (maxRequired === 0) return 0;
  const coverage =
    consumedBytes === 0n
      ? 1.0
      : Math.min(1, Number(eligibleContributionBytes) / Number(consumedBytes));
  return Math.max(minRequired, maxRequired * (1 - coverage));
};

// 72-hour minimum age before a contribution counts toward coverage
const ELIGIBILITY_WINDOW_MS = 72 * 60 * 60 * 1000;

export const getEligibleContributionBytes = async (
  userId: number
): Promise<bigint> => {
  const cutoff = new Date(Date.now() - ELIGIBILITY_WINDOW_MS);
  // Count a contribution toward coverage only if staff approved it
  // (approvedAccountingBytes set) AND its link is not confirmed dead. A live
  // link is the seeding analog — relief tracks ongoing availability, so a
  // FAIL contribution drops out of the pool (ADR-0006). WARN/UNKNOWN still
  // count: suspicion alone never revokes; only a confirmed FAIL does.
  const contributions = await prisma.contribution.findMany({
    where: {
      userId,
      createdAt: { lt: cutoff },
      approvedAccountingBytes: { not: null },
      linkStatus: { not: LinkHealthStatus.FAIL }
    },
    select: { approvedAccountingBytes: true }
  });
  return contributions.reduce<bigint>(
    (sum, c) => sum + c.approvedAccountingBytes!,
    0n
  );
};

export interface RatioStats {
  ratio: number;
  contributed: string;
  consumed: string;
  bracket: { label: string; maxRequired: number; minRequired: number };
  eligibleContributionBytes: string;
  contributionCoverage: number;
  requiredRatio: number;
  meetsRequirement: boolean;
}

export const getRatioStats = async (userId: number): Promise<RatioStats> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { contributed: true, consumed: true }
  });
  if (!user) throw new AppError(404, 'User not found');

  const { contributed, consumed } = user;
  const eligibleBytes = await getEligibleContributionBytes(userId);

  const ratio = computeRatio(contributed, consumed);
  const bracket = getConsumptionBracket(consumed);
  const coverage =
    consumed === 0n
      ? 1.0
      : Math.min(1, Number(eligibleBytes) / Number(consumed));
  const required = computeRequiredRatio(consumed, eligibleBytes);

  return {
    ratio,
    contributed: contributed.toString(),
    consumed: consumed.toString(),
    bracket,
    eligibleContributionBytes: eligibleBytes.toString(),
    contributionCoverage: coverage,
    requiredRatio: required,
    meetsRequirement: ratio >= required
  };
};
