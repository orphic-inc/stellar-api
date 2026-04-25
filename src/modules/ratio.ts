import { prisma } from '../lib/prisma';

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

export const computeRatio = (
  totalEarned: bigint,
  downloaded: bigint
): number => {
  if (downloaded === 0n) return 1.0;
  return Number(totalEarned) / Number(downloaded);
};

export const getDownloadBracket = (
  downloadedBytes: bigint
): { maxRequired: number; minRequired: number; label: string } => {
  for (const b of BRACKETS) {
    if (b.upTo === null || downloadedBytes < b.upTo) {
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
  downloadedBytes: bigint,
  eligibleContributionBytes: bigint
): number => {
  const { maxRequired, minRequired } = getDownloadBracket(downloadedBytes);
  if (maxRequired === 0) return 0;
  const coverage =
    downloadedBytes === 0n
      ? 1.0
      : Math.min(
          1,
          Number(eligibleContributionBytes) / Number(downloadedBytes)
        );
  return Math.max(minRequired, maxRequired * (1 - coverage));
};

// 72-hour minimum age before a contribution counts toward coverage
const ELIGIBILITY_WINDOW_MS = 72 * 60 * 60 * 1000;

export const getEligibleContributionBytes = async (
  userId: number
): Promise<bigint> => {
  const cutoff = new Date(Date.now() - ELIGIBILITY_WINDOW_MS);
  // Only count contributions that staff have explicitly approved (approvedAccountingBytes set)
  const contributions = await prisma.contribution.findMany({
    where: {
      userId,
      createdAt: { lt: cutoff },
      approvedAccountingBytes: { not: null }
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
  totalEarned: string;
  downloaded: string;
  bracket: { label: string; maxRequired: number; minRequired: number };
  eligibleContributionBytes: string;
  contributionCoverage: number;
  requiredRatio: number;
  meetsRequirement: boolean;
}

export const getRatioStats = async (userId: number): Promise<RatioStats> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totalEarned: true, downloaded: true }
  });
  if (!user) throw new Error('User not found');

  const { totalEarned, downloaded } = user;
  const eligibleBytes = await getEligibleContributionBytes(userId);

  const ratio = computeRatio(totalEarned, downloaded);
  const bracket = getDownloadBracket(downloaded);
  const coverage =
    downloaded === 0n
      ? 1.0
      : Math.min(1, Number(eligibleBytes) / Number(downloaded));
  const required = computeRequiredRatio(downloaded, eligibleBytes);

  return {
    ratio,
    totalEarned: totalEarned.toString(),
    downloaded: downloaded.toString(),
    bracket,
    eligibleContributionBytes: eligibleBytes.toString(),
    contributionCoverage: coverage,
    requiredRatio: required,
    meetsRequirement: ratio >= required
  };
};
