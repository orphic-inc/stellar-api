/**
 * Whether a member may send an invite right now (#637, ADR-0043). Pure: the
 * caller loads the member's state, so the order is testable without a database.
 *
 * The send and the eligibility read both answer from `firstInviteRefusal`, so
 * the page that explains a refusal can never disagree with the POST.
 *
 * The order is what the member would have to fix first, with staff decisions
 * above state the member caused. A revoked member on a full site hears about
 * the revoke, not "try later"; a member with no invites who is also on ratio
 * watch hears about the ratio, because a grant would not let them send.
 */
import { RatioPolicyStatus } from '@prisma/client';
import { isStandingDenied } from './inviteGrant';
import type { Standing } from './standing';

/** Every refusal, first to last. A tuple so the OpenAPI enum reads it. */
export const INVITE_GATE_ORDER = [
  'invites_revoked',
  'downloads_disabled',
  'poor_standing',
  'ratio_watch',
  'site_full',
  'no_invites'
] as const;

export type InviteGateRefusal = (typeof INVITE_GATE_ORDER)[number];

export interface InviteGateInput {
  /** `User.canInvite` — staff revoked invite privileges (#636). */
  canInvite: boolean;
  /** `User.canDownload` — a failed ratio watch or a staff override (#646). */
  canDownload: boolean;
  /** From `computeStanding`; denied by the handout's own `isStandingDenied`. */
  standing: Standing;
  /** From `isOnRatioWatch`, which reads the ratio fresh. */
  onRatioWatch: boolean;
  /** `isSiteFull()`. A courtesy: registration is the exact gate (ADR-0040 §3). */
  siteFull: boolean;
  /** `User.inviteCount`. */
  balance: number;
}

const REFUSES: Record<InviteGateRefusal, (input: InviteGateInput) => boolean> =
  {
    invites_revoked: (i) => !i.canInvite,
    downloads_disabled: (i) => !i.canDownload,
    poor_standing: (i) => isStandingDenied(i.standing),
    ratio_watch: (i) => i.onRatioWatch,
    site_full: (i) => i.siteFull,
    no_invites: (i) => i.balance <= 0
  };

export const firstInviteRefusal = (
  input: InviteGateInput
): InviteGateRefusal | null =>
  INVITE_GATE_ORDER.find((reason) => REFUSES[reason](input)) ?? null;

/**
 * On watch, for inviting: the stored status AND the ratio read now.
 *
 * The status alone goes stale. `evaluateRatioPolicy` runs only after a
 * download, so a member who recovers by contributing stays `WATCH` in the row
 * until they next download. A watch that ran out without a download also stays
 * `WATCH`, and still refuses here while the ratio is short.
 */
export const isOnRatioWatch = (
  status: RatioPolicyStatus | null,
  meetsRequirement: boolean
): boolean => status === RatioPolicyStatus.WATCH && !meetsRequirement;
