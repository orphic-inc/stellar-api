/**
 * Whether a member may send an invite right now (#637, ADR-0043), and the words
 * each refusal answers in (#656). Pure: the caller loads the member's state, so
 * the order is testable without a database. The copy below reads `site` for one
 * configured path and touches nothing else.
 *
 * The send and the eligibility read both answer from `firstInviteRefusal`, so
 * the page that explains a refusal can never disagree with the POST.
 *
 * The order is what the member would have to fix first, with staff decisions
 * above state the member caused. A revoked member on a full site hears about
 * the revoke, not "try later"; a member with no invites who is also on ratio
 * watch hears about the ratio, because a grant would not let them send.
 *
 * The member can fix neither `registration_closed` nor `site_full`, so that
 * rule does not order the two (#673). `registerUser` does: its mode gate runs
 * before the capacity count, so these sit in the same sequence and an inviter
 * is never told a different story about one site than their invitee. It also
 * names the more durable fact — a full site frees a seat on its own, a closed
 * one waits on an operator.
 */
import { RatioPolicyStatus } from '@prisma/client';
import { isStandingDenied } from './inviteGrant';
import { site } from './config';
import type { Standing } from './standing';

/** Every refusal, first to last. A tuple so the OpenAPI enum reads it. */
export const INVITE_GATE_ORDER = [
  'invites_revoked',
  'downloads_disabled',
  'poor_standing',
  'ratio_watch',
  'registration_closed',
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
  /**
   * `registrationStatus === 'closed'`, resolved by the caller (#673).
   *
   * A boolean and not the enum on purpose. The rule is about `closed` alone:
   * an `invite` site is the one that needs invites most, and a module holding
   * the three-way value invites a later `!== 'open'` that would silently stop
   * it sending. What it cannot see, it cannot be tidied into.
   */
  registrationClosed: boolean;
  /** `isSiteFull()`. A courtesy: registration is the exact gate (ADR-0040 §3). */
  siteFull: boolean;
  /** `User.inviteCount`. */
  balance: number;
  /** `invites_unlimited` (ADR-0043 §5): skips `no_invites`, and nothing else. */
  unlimited: boolean;
}

const REFUSES: Record<InviteGateRefusal, (input: InviteGateInput) => boolean> =
  {
    invites_revoked: (i) => !i.canInvite,
    downloads_disabled: (i) => !i.canDownload,
    poor_standing: (i) => isStandingDenied(i.standing),
    ratio_watch: (i) => i.onRatioWatch,
    registration_closed: (i) => i.registrationClosed,
    site_full: (i) => i.siteFull,
    no_invites: (i) => !i.unlimited && i.balance <= 0
  };

export const firstInviteRefusal = (
  input: InviteGateInput
): InviteGateRefusal | null =>
  INVITE_GATE_ORDER.find((reason) => REFUSES[reason](input)) ?? null;

/**
 * The words for each send gate (#637, ADR-0043), composed per surface (#656).
 *
 * The POST refusal and the eligibility read answer from the same entry, so the
 * page explaining a refusal can never disagree with the send. They differ in
 * exactly one clause, so each reason has ONE set of words here rather than two
 * that would have to be kept in step.
 *
 *   base + (a send, and the reason spends ? SPEND : '') + (pointer ?? '')
 *
 * Every `base` is present tense and states a condition, so it is true before a
 * send as well as after one. `SPEND` is the only send-specific clause: it
 * reassures a member who just tried that their balance is intact, and it is
 * nonsense on the eligibility page, where nothing was attempted.
 *
 * Three things here are deliberate:
 *
 *  - The POINTER is a separate field rather than part of `base`, because it
 *    must stay LAST. stellar-ui linkifies a path anchored to the end of the
 *    message (`TRAILING_PATH` in `InviteForm.tsx`), so a clause appended after
 *    it would silently turn the Staff PM link back into plain text. Keeping it
 *    last is a property this module owes the ui, not a style choice.
 *  - `no_invites` takes no SPEND clause. "You have no invites remaining. Your
 *    invite was not used." contradicts itself — there was none to use.
 *  - An `invites_unlimited` member still gets SPEND. Their stored balance keeps
 *    accruing as the fallback if the permission is removed (ADR-0043 §5), so it
 *    is a balance they really hold and really did not spend.
 */
interface InviteRefusalCopy {
  /** Present tense, true whether or not a send was attempted. */
  base: string;
  /** Whether the send's reply reassures that no invite was spent. */
  spends: boolean;
  /** Appended last, after any spend clause. */
  pointer?: string;
}

export const SPEND = 'Your invite was not used.';
const STAFF_PM = `Contact staff through Staff PM: ${site.staffPmPath}`;

export const INVITE_REFUSAL: Record<InviteGateRefusal, InviteRefusalCopy> = {
  invites_revoked: {
    base: 'Your invite privileges have been revoked, so invites cannot be sent.',
    spends: true,
    pointer: STAFF_PM
  },
  downloads_disabled: {
    base: 'Your download access is disabled, so invites cannot be sent.',
    spends: true,
    pointer: STAFF_PM
  },
  poor_standing: {
    base: 'You have active warnings, so invites cannot be sent until they expire.',
    spends: true
  },
  ratio_watch: {
    base: 'You are on ratio watch, so invites cannot be sent until your ratio meets its requirement.',
    spends: true
  },
  registration_closed: {
    base: 'Registration is currently closed, so invites cannot be sent right now.',
    spends: true
  },
  site_full: {
    base: 'The site is full, so invites cannot be sent right now.',
    spends: true
  },
  no_invites: { base: 'You have no invites remaining.', spends: false }
};

/**
 * The refusal in the words for this surface. `sent` is whether the caller just
 * attempted a send, which is the only thing the two surfaces disagree about.
 */
export const inviteRefusalMsg = (
  reason: InviteGateRefusal,
  { sent }: { sent: boolean }
): string => {
  const { base, spends, pointer } = INVITE_REFUSAL[reason];
  return [base, sent && spends ? SPEND : '', pointer ?? '']
    .filter(Boolean)
    .join(' ');
};

/**
 * On watch, for inviting: the stored status AND the ratio read now.
 *
 * The status alone can be stale: it moves after a download or on the daily
 * ratio policy sweep (#646), so a member who recovers by contributing can still
 * read `WATCH` for up to a day. The fresh ratio read covers that gap.
 */
export const isOnRatioWatch = (
  status: RatioPolicyStatus | null,
  meetsRequirement: boolean
): boolean => status === RatioPolicyStatus.WATCH && !meetsRequirement;
