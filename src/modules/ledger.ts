/**
 * korin.pink `ledger` client (ADR-0016) — the consumption-accounting + ratio-gate
 * contract, an extension of the ADR-0013 shared-secret boundary. stellar is the
 * system of record and the ORIGIN of every consumption event; korin's `ledger` is a
 * derived hot-path read-model that sums stellar's authoritative events. This module
 * is the stellar-side producer surface:
 *
 *   - pushConsumptionEvent    → POST /ledger/consumption  (stellar pushes; korin sums)
 *   - checkCanConsume         → GET  /ledger/can-consume   (stellar pulls the gate; fail-open)
 *   - getNewConsumptionEvents → the grant rows the drain job (ledgerJob) emits
 *
 * Inert until KORIN_API_URL + KORIN_PULL_KEY are set — same posture as irc.ts /
 * announce.ts. stellar PRE-RESOLVES the ratio impact of each grant (Freepass →
 * consumedDelta 0; Neutralpass → both 0) so korin never re-derives pass logic.
 */
import {
  DownloadGrantStatus,
  RatioExempt,
  RatioPolicyStatus,
  LinkHealthStatus
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { korin } from './config';
import { getLogger } from './logging';

const log = getLogger('ledger');

// Hot-path gate: bound the wait, then fail open. A korin outage must never
// hard-block consumption (ADR-0016 ratio-gate row).
const CAN_CONSUME_TIMEOUT_MS = 2_000;

export type Pass = 'none' | 'freepass' | 'neutralpass';

/**
 * A consumption event. `kind` extends ADR-0016's illustrative body with a reversal
 * discriminator so korin dedupes idempotently on `(grantId, kind)` — a grant and its
 * later reversal share `grantId` but move opposite deltas. Coordinate the final wire
 * shape with korin ADR-004. Deltas are BigInt-as-string (byte counts).
 */
export interface ConsumptionEvent {
  grantId: number;
  kind: 'grant' | 'reversal';
  userId: number; // the consumer
  contributorId: number;
  contributionId: number;
  consumedDelta: string;
  contributedDelta: string;
  pass: Pass;
  at: string;
}

export interface CanConsumeVerdict {
  allow: boolean;
  reason?: string;
  currentRatio?: number;
  requiredRatio?: number;
  policyState?: string;
}

/**
 * The ratio impact stellar resolves for a grant before emitting it. Freepass keeps
 * the contributor's credit but zeroes the consumer's debit; Neutralpass zeroes both.
 * This mirrors the accrual suppression in `downloads.ts` (PRD-06 #4) exactly.
 */
export const resolveDeltas = (
  amountBytes: bigint,
  ratioExempt: RatioExempt
): { consumedDelta: bigint; contributedDelta: bigint; pass: Pass } => {
  switch (ratioExempt) {
    case RatioExempt.FREEPASS:
      return {
        consumedDelta: 0n,
        contributedDelta: amountBytes,
        pass: 'freepass'
      };
    case RatioExempt.NEUTRALPASS:
      return { consumedDelta: 0n, contributedDelta: 0n, pass: 'neutralpass' };
    default:
      return {
        consumedDelta: amountBytes,
        contributedDelta: amountBytes,
        pass: 'none'
      };
  }
};

/** Fields a `DownloadAccessGrant` contributes to an event (grant or reversal). */
export interface GrantEventSource {
  id: number;
  consumerId: number;
  contributorId: number;
  contributionId: number;
  amountBytes: bigint;
  ratioExempt: RatioExempt;
  at: Date;
}

export const buildConsumptionEvent = (
  grant: GrantEventSource,
  kind: 'grant' | 'reversal'
): ConsumptionEvent => {
  const { consumedDelta, contributedDelta, pass } = resolveDeltas(
    grant.amountBytes,
    grant.ratioExempt
  );
  // A reversal negates exactly what the grant accrued — never a blind `amountBytes`,
  // or an exempt grant's reversal would fabricate a delta out of nothing.
  const sign = kind === 'reversal' ? -1n : 1n;
  return {
    grantId: grant.id,
    kind,
    userId: grant.consumerId,
    contributorId: grant.contributorId,
    contributionId: grant.contributionId,
    consumedDelta: (sign * consumedDelta).toString(),
    contributedDelta: (sign * contributedDelta).toString(),
    pass,
    at: grant.at.toISOString()
  };
};

/**
 * Push one consumption event to korin. Best-effort (returns a 2xx flag); the caller
 * decides retry. Idempotent on `(grantId, kind)` — korin's responsibility.
 */
export const pushConsumptionEvent = async (
  event: ConsumptionEvent
): Promise<boolean> => {
  const { apiUrl, pullKey } = korin;
  if (!apiUrl || !pullKey) return false;

  try {
    const res = await fetch(`${apiUrl}/ledger/consumption`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pull-key': pullKey },
      body: JSON.stringify(event)
    });
    if (!res.ok) {
      log.warn('korin /ledger/consumption returned non-2xx', {
        status: res.status,
        grantId: event.grantId,
        kind: event.kind
      });
      return false;
    }
    return true;
  } catch (err) {
    log.error('Failed to push consumption event to korin', {
      err,
      grantId: event.grantId,
      kind: event.kind
    });
    return false;
  }
};

/**
 * Ask korin's hot state whether a user may consume a contribution now. Returns the
 * verdict on a 2xx, or `null` on unset keys / non-2xx / timeout / network error —
 * `null` is the FAIL-OPEN signal: the caller must fall back to stellar's own
 * read-time checks, never hard-block (ADR-0016).
 */
export const checkCanConsume = async (
  userId: number,
  contributionId: number
): Promise<CanConsumeVerdict | null> => {
  const { apiUrl, pullKey } = korin;
  if (!apiUrl || !pullKey) return null;

  try {
    const url = `${apiUrl}/ledger/can-consume?userId=${userId}&contributionId=${contributionId}`;
    const res = await fetch(url, {
      headers: { 'x-pull-key': pullKey },
      signal: AbortSignal.timeout(CAN_CONSUME_TIMEOUT_MS)
    });
    if (!res.ok) {
      log.warn('korin /ledger/can-consume returned non-2xx — failing open', {
        status: res.status,
        userId,
        contributionId
      });
      return null;
    }
    return (await res.json()) as CanConsumeVerdict;
  } catch (err) {
    log.warn('korin /ledger/can-consume unreachable — failing open', {
      err,
      userId,
      contributionId
    });
    return null;
  }
};

/**
 * New COMPLETED grants after `sinceId`, oldest first, as consumption events — the
 * source the drain job (ledgerJob) pushes. One grant = one event (cleaner than the
 * two-rows-per-grant economy ledger). Reversals aren't caught here (status changes in
 * place, not a new id); they're pushed inline by `reverseDownloadAccess`.
 */
export const getNewConsumptionEvents = async (
  sinceId: number,
  limit = 50
): Promise<ConsumptionEvent[]> => {
  const grants = await prisma.downloadAccessGrant.findMany({
    where: { id: { gt: sinceId }, status: DownloadGrantStatus.COMPLETED },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      consumerId: true,
      contributorId: true,
      contributionId: true,
      amountBytes: true,
      ratioExempt: true,
      createdAt: true
    }
  });

  return grants.map((g) =>
    buildConsumptionEvent(
      {
        id: g.id,
        consumerId: g.consumerId,
        contributorId: g.contributorId,
        contributionId: g.contributionId,
        amountBytes: g.amountBytes,
        ratioExempt: g.ratioExempt,
        at: g.createdAt
      },
      'grant'
    )
  );
};

// ─── Working-set snapshot (korin pulls to seed) ──────────────────────────────

export interface LedgerSnapshot {
  generatedAt: string;
  users: {
    id: number;
    contributed: string;
    consumed: string;
    canDownload: boolean;
    policyState: RatioPolicyStatus;
  }[];
  contributions: {
    id: number;
    userId: number;
    approvedAccountingBytes: string | null;
    linkStatus: LinkHealthStatus;
    ratioExempt: RatioExempt;
  }[];
}

/**
 * The durable state korin pulls on boot / reload to seed its hot working set
 * (ADR-0016 working-set-snapshot flow): per-user balances + policy state, and
 * per-contribution accounting size / link status / pass flag. BigInt → string.
 */
export const getLedgerSnapshot = async (): Promise<LedgerSnapshot> => {
  const [users, contributions] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        contributed: true,
        consumed: true,
        canDownload: true,
        ratioPolicyState: { select: { status: true } }
      }
    }),
    prisma.contribution.findMany({
      select: {
        id: true,
        userId: true,
        approvedAccountingBytes: true,
        linkStatus: true,
        ratioExempt: true
      }
    })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    users: users.map((u) => ({
      id: u.id,
      contributed: u.contributed.toString(),
      consumed: u.consumed.toString(),
      canDownload: u.canDownload,
      // No policy row yet ⇒ the schema default (OK).
      policyState: u.ratioPolicyState?.status ?? RatioPolicyStatus.OK
    })),
    contributions: contributions.map((c) => ({
      id: c.id,
      userId: c.userId,
      approvedAccountingBytes: c.approvedAccountingBytes?.toString() ?? null,
      linkStatus: c.linkStatus,
      ratioExempt: c.ratioExempt
    }))
  };
};
