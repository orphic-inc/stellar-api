import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma, RecoveryPurpose } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { computeRatio } from './ratio';
import { activeWarnedUntil } from './standing';
import { computeUserRankAccess, resolveRankQuota } from '../lib/userRankAccess';
import { getDefaultStylesheetName } from './stylesheet';
import { normalizePassword } from './badPasswords';
import { isEmailBlacklisted } from './emailBlacklist';
import { countSeats } from './settings';
import { isInviteLapsed, livePendingInviteWhere } from './inviteExpiry';
import { getLogger } from './logging';

const log = getLogger('auth');

/**
 * Is this password on the denylist?
 *
 * Lowercased before lookup, and every stored row is lowercase, so the match is
 * case-insensitive. Doing the folding here rather than with Prisma's
 * `mode: 'insensitive'` keeps the query an exact match, which is what the
 * `@unique` btree index on `password` can actually serve.
 *
 * `findUnique` rather than `findFirst`: the column is unique, so there is never
 * a second row to scan for.
 */
export const isPasswordBanned = async (password: string): Promise<boolean> => {
  const found = await prisma.badPassword.findUnique({
    where: { password: normalizePassword(password) },
    select: { id: true }
  });
  return !!found;
};

export const authUserSelect = {
  id: true,
  username: true,
  email: true,
  avatar: true,
  isArtist: true,
  isDonor: true,
  canDownload: true,
  canInvite: true,
  inviteCount: true,
  dateRegistered: true,
  lastLogin: true,
  contributed: true,
  consumed: true,
  userRank: {
    select: {
      id: true,
      level: true,
      name: true,
      color: true,
      badge: true,
      permissions: true,
      personalCollageLimit: true,
      authorStylesheetLimit: true,
      // The primary rank's alone (#715), because that is what
      // getFilterAllowance enforces. Null is unlimited and stays null on the
      // wire: `0` means the rank has no filters, unlike the two limits above.
      notificationFilterLimit: true
    }
  },
  secondaryRanks: {
    select: {
      userRankId: true,
      userRank: {
        select: {
          id: true,
          level: true,
          permissions: true,
          permittedForumIds: true,
          personalCollageLimit: true,
          authorStylesheetLimit: true
        }
      }
    }
  },
  // Ratio policy state on the session (#659, ADR-0044), so a surface rendered
  // on every page can read it without a request of its own. A SUBSET of
  // RatioPolicyState: deliberately not `requiredRatio`, which needs
  // getEligibleContributionBytes — an unbounded read over the member's
  // contributions that has no business on the session's hot path.
  // A 1:1 relation keyed on the primary key, so this is an indexed join.
  ratioPolicyState: {
    select: { status: true, watchExpiresAt: true, disabledCause: true }
  },
  // For `warnedUntil` (#719). A member's warnings are few, so the whole set is
  // filtered by the clock in toAuthUser rather than in the query.
  warnings: { select: { expiresAt: true } }
} as const;

type RawAuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

/** The session's view of ratio policy: null when the member has no row. */
export type SessionRatioPolicy = RawAuthUser['ratioPolicyState'];

export type AuthUser = Omit<
  RawAuthUser,
  'contributed' | 'consumed' | 'ratioPolicyState' | 'warnings'
> & {
  contributed: string;
  consumed: string;
  // Derived from contributed/consumed at read time (computeRatio), not stored.
  ratio: number;
  // Renamed off the relation: consumers read a policy, not a table row. Null
  // when no row exists, which the policy itself reads as OK (getPolicyState).
  ratioPolicy: SessionRatioPolicy;
  // When the member's own warned state ends (#719), for the expiry tooltip on
  // their own name. Here rather than on AuthorRef, which would send every
  // author's expiry to every viewer. Null for no active warning AND for a
  // permanent one: the author's `warned` tells those apart.
  warnedUntil: string | null;
};

export const toAuthUser = (raw: RawAuthUser): AuthUser => {
  // Destructured out rather than spread: the wire name is `ratioPolicy`, and
  // leaving the relation in would ship both spellings of the same thing.
  const { ratioPolicyState, warnings, ...rest } = raw;
  const rankQuotaInputs = (
    field: 'personalCollageLimit' | 'authorStylesheetLimit'
  ): number[] => [
    raw.userRank[field] ?? 0,
    ...raw.secondaryRanks.map((entry) => entry.userRank[field] ?? 0)
  ];

  return {
    ...rest,
    userRank: {
      ...raw.userRank,
      permissions: computeUserRankAccess({
        userRankId: raw.userRank.id,
        userRank: {
          id: raw.userRank.id,
          level: raw.userRank.level,
          permissions: raw.userRank.permissions,
          permittedForumIds: []
        },
        secondaryRanks: raw.secondaryRanks.map((entry) => ({
          userRankId: entry.userRankId,
          userRank: {
            id: entry.userRank.id,
            level: entry.userRank.level,
            permissions: entry.userRank.permissions,
            permittedForumIds: entry.userRank.permittedForumIds
          }
        }))
      }).permissions,
      // Resolved across primary + secondary ranks, with 0 meaning unlimited.
      // The wire keeps representing unlimited as 0, which is what it has always
      // meant here — resolveRankQuota's null is the internal spelling only.
      // Math.max alone inverted the semantic: an unlimited primary rank plus a
      // donor secondary of 5 advertised 5, i.e. a perk that *lowered* a ceiling
      // (#369). Enforcement reads the same resolver via getUserRankQuotas.
      personalCollageLimit:
        resolveRankQuota(rankQuotaInputs('personalCollageLimit')) ?? 0,
      authorStylesheetLimit:
        resolveRankQuota(rankQuotaInputs('authorStylesheetLimit')) ?? 0
    },
    ratio: computeRatio(raw.contributed, raw.consumed),
    contributed: raw.contributed.toString(),
    consumed: raw.consumed.toString(),
    // `?? null` so the key is always present on the wire. Prisma returns null
    // for a missing relation, but an undefined here would drop the field from
    // the JSON entirely and make "no row" indistinguishable from "old server".
    ratioPolicy: ratioPolicyState ?? null,
    warnedUntil: activeWarnedUntil(warnings, new Date())?.toISOString() ?? null
  };
};

type RegisterResult =
  | {
      ok: false;
      reason:
        | 'user_exists'
        | 'bad_password'
        | 'email_blacklisted'
        | 'registration_closed'
        | 'invite_required'
        | 'invalid_invite'
        | 'invite_email_mismatch'
        | 'invite_expired';
    }
  | {
      ok: false;
      reason: 'registration_full';
      /** Present when an invite was presented, so the refusal can say how long it stays valid. */
      inviteExpires?: Date;
    }
  | { ok: true; user: AuthUser };

export type RegisterOptions = {
  username: string;
  email: string;
  password: string;
  /** Passed from getSettings().registrationStatus — the module does not read settings itself. */
  registrationMode: 'open' | 'invite' | 'closed';
  /** Passed from getSettings().maxUsers, for the same reason. Required: an omitted cap would be an unenforced one (#624). */
  maxUsers: number;
  inviteKey?: string;
};

/**
 * Serializes self-registration so the last seat goes to exactly one caller
 * (#624, ADR-0040). A transaction-scoped Postgres advisory lock: released on
 * commit or rollback, so no path can leak it. The value is arbitrary but must
 * not be reused for any other lock.
 */
const REGISTRATION_SEAT_LOCK_KEY = 624_001;

/** Thrown inside the registration transaction to roll back the user it created. */
class InviteLapsedDuringRegistration extends Error {}

type InviteCheck =
  | {
      ok: false;
      reason: 'invalid_invite' | 'invite_email_mismatch' | 'invite_expired';
    }
  | { ok: true; expires: Date; inviterId: number };

/**
 * Pre-validate a presented invite key for an early exit before any writes. The
 * consumption itself is a claim inside the registration transaction, because
 * the sweep can expire this invite between this read and that write (#627).
 *
 * The email match is checked before the lapse, so a key that is not yours says
 * nothing about whether it is still live. A disabled inviter answers as a
 * lapse, not as `invalid_invite` (so does a revoked one, #636): the sweep will mark that invite `expired`
 * within the hour, and the reply must not change when it does.
 */
const checkInvite = async (
  inviteKey: string,
  email: string,
  now: Date
): Promise<InviteCheck> => {
  const invite = await prisma.invite.findUnique({
    where: { inviteKey },
    select: {
      email: true,
      status: true,
      expires: true,
      inviterId: true,
      inviter: { select: { disabled: true, canInvite: true } }
    }
  });
  if (!invite || invite.status === 'accepted') {
    return { ok: false, reason: 'invalid_invite' };
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, reason: 'invite_email_mismatch' };
  }
  const lapsed = isInviteLapsed(
    {
      status: invite.status,
      expires: invite.expires,
      inviterDisabled: invite.inviter.disabled,
      inviterCanInvite: invite.inviter.canInvite
    },
    now
  );
  return lapsed
    ? { ok: false, reason: 'invite_expired' }
    : { ok: true, expires: invite.expires, inviterId: invite.inviterId };
};

type LoginResult =
  | { ok: false; reason: 'not_found' | 'disabled' | 'wrong_password' }
  | { ok: true; user: AuthUser };

export const registerUser = async ({
  username,
  email,
  password,
  registrationMode,
  maxUsers,
  inviteKey
}: RegisterOptions): Promise<RegisterResult> => {
  // 1. Mode gate — no DB required
  if (registrationMode === 'closed') {
    return { ok: false, reason: 'registration_closed' };
  }

  let inviteExpires: Date | undefined;
  // The invite this registration will try to claim. Whether one is REQUIRED is
  // the mode's business; whether one is HONOURED is not (#675). An `open` site
  // used to ignore a presented key outright, so the invite was spent, the
  // account was created with no `InviteTree` edge, and the invite lapsed —
  // leaving two members who believe an invitation happened and a tree that
  // records none of it.
  let presented: { inviteKey: string; inviterId: number } | null = null;
  if (registrationMode === 'invite') {
    if (!inviteKey) return { ok: false, reason: 'invite_required' };
    const invite = await checkInvite(inviteKey, email, new Date());
    if (!invite.ok) return invite;
    inviteExpires = invite.expires;
    presented = { inviteKey, inviterId: invite.inviterId };
  } else if (inviteKey) {
    // Lenient, because here the key is not the gate. A stale, mistyped or
    // someone else's key must not refuse a registration this site would have
    // accepted with no key at all; it is simply not honoured. `checkInvite`
    // matches the key against the address it was issued to, so a guessed one
    // buys nothing either way.
    //
    // `inviteExpires` stays unset on purpose: it exists for the "your invite
    // is valid until" wording on a full site (#627), which is invite-mode
    // reasoning and has its own history. Out of scope here.
    const invite = await checkInvite(inviteKey, email, new Date());
    if (invite.ok) {
      presented = { inviteKey, inviterId: invite.inviterId };
    } else {
      log.info('Invite key not honoured; registering without an inviter', {
        reason: invite.reason,
        registrationMode
      });
    }
  }

  // 2. Uniqueness / quality checks
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username }] }
  });
  if (existing) return { ok: false, reason: 'user_exists' };

  // Deliberately independent of the invite branch above: a blacklisted address
  // holding a valid invite is precisely the case a moderator is trying to stop
  // — someone banned returning through a friend.
  if (await isEmailBlacklisted(email)) {
    return { ok: false, reason: 'email_blacklisted' };
  }

  if (await isPasswordBanned(password)) {
    return { ok: false, reason: 'bad_password' };
  }

  const defaultRank = await prisma.userRank.findFirst({
    where: { level: 100 }
  });
  if (!defaultRank)
    throw new AppError(
      503,
      'Server misconfigured: default rank missing. Run setup.'
    );

  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));

  // 3. Atomic: consume the invite + create the user in one transaction so a
  //    crash between the two can never leave the invite permanently open.
  const created = prisma.$transaction(async (tx): Promise<RegisterResult> => {
    // Capacity (#624, ADR-0040). Lock, THEN count: under READ COMMITTED each
    // statement sees rows committed before it began, so a caller that waited
    // on the lock counts the seat its predecessor just took. Counting before
    // the lock would let concurrent callers all see the same last free seat.
    // Refusing here returns before any write, so the invite is left pending.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_SEAT_LOCK_KEY}::bigint)`;
    if ((await countSeats(tx)) >= maxUsers) {
      return {
        ok: false,
        reason: 'registration_full',
        ...(inviteExpires ? { inviteExpires } : {})
      };
    }

    // Claim the invite BEFORE the account, so the edge below is written from
    // what the claim actually took rather than from the pre-check (#675). A
    // claim, not a plain update: if the sweep expired and refunded this invite
    // since the pre-check, accepting it too would count it twice.
    let inviterId: number | null = null;
    if (presented) {
      const { count } = await tx.invite.updateMany({
        where: {
          inviteKey: presented.inviteKey,
          ...livePendingInviteWhere(new Date())
        },
        data: { status: 'accepted' }
      });
      if (count > 0) {
        inviterId = presented.inviterId;
      } else if (registrationMode === 'invite') {
        // The key was the gate, so losing it means no account. Throwing rolls
        // back the claim and the account is never created.
        throw new InviteLapsedDuringRegistration();
      } else {
        // It was not the gate. Keep the account and drop the edge: a race with
        // the hourly sweep must not cost somebody a registration they needed
        // no key for.
        log.info(
          'Invite lapsed mid-registration; registering without an inviter',
          {
            registrationMode
          }
        );
      }
    }

    const defaultTheme = await getDefaultStylesheetName(tx);
    const settings = await tx.userSettings.create({
      data: { siteAppearance: defaultTheme }
    });
    const profile = await tx.profile.create({ data: {} });
    const newUser = await tx.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        password: hashedPassword,
        // avatar left null — UI falls back to the bundled default avatar.
        // Gravatar was removed to avoid leaking email hashes (private site).
        userRankId: defaultRank.id,
        userSettingsId: settings.id,
        profileId: profile.id,
        contributed: 5_368_709_120n,
        // Every account has an InviteTree row (#633, ADR-0042). `inviterId` is
        // null unless the claim above took an invite, so an edge can only name
        // an inviter whose invite this registration actually consumed.
        inviteTree: { create: { inviterId } }
      },
      select: authUserSelect
    });

    return { ok: true, user: toAuthUser(newUser) };
  });

  return created.catch((err: unknown): RegisterResult => {
    if (err instanceof InviteLapsedDuringRegistration) {
      return { ok: false, reason: 'invite_expired' };
    }
    throw err;
  });
};

export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true }
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new AppError(400, 'Current password is incorrect');

  if (await isPasswordBanned(newPassword)) {
    throw new AppError(400, 'Password is not allowed');
  }

  const hashed = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { password: hashed }
    }),
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);
};

export const changeEmail = async (
  userId: number,
  newEmail: string,
  password: string,
  ipAddress: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, password: true }
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AppError(400, 'Password is incorrect');

  const taken = await prisma.user.findUnique({
    where: { email: newEmail.toLowerCase() }
  });
  if (taken) throw new AppError(400, 'Email already in use');

  // Registration is not the only way an address enters the system. Guarding it
  // alone would leave a member free to register clean and then move to a
  // blacklisted address.
  if (await isEmailBlacklisted(newEmail)) {
    throw new AppError(400, 'That email address is not available');
  }

  await prisma.$transaction([
    prisma.userEmailHistory.create({
      data: {
        userId,
        oldEmail: user.email,
        newEmail: newEmail.toLowerCase(),
        ipAddress
      }
    }),
    prisma.user.update({
      where: { id: userId },
      data: { email: newEmail.toLowerCase() }
    })
  ]);
};

export const generateRecoveryToken = (): string =>
  crypto.randomBytes(32).toString('hex');

// Persists a password-reset token for userId: expires pending reset tokens
// first, then inserts a fresh record valid for 2 hours. Call only after email
// delivery succeeds to avoid orphaned rows when SMTP is unconfigured.
//
// The invalidation stays scoped BY PURPOSE (ADR-0038 §2) even with one purpose
// left, so a second flow added later cannot silently expire a reset in flight.
export const persistRecoveryToken = async (
  userId: number,
  token: string
): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const purpose = RecoveryPurpose.PasswordReset;

  await prisma.$transaction([
    prisma.accountRecovery.updateMany({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now }
    }),
    prisma.accountRecovery.create({
      data: { userId, token, expiresAt, purpose }
    })
  ]);
};

export const resetPasswordWithToken = async (
  token: string,
  newPassword: string
): Promise<void> => {
  // Filtered on `purpose` so a token minted for any other flow can never set a
  // password (ADR-0038 §2). PasswordReset is the only purpose today (#629).
  const recovery = await prisma.accountRecovery.findFirst({
    where: {
      token,
      purpose: RecoveryPurpose.PasswordReset,
      usedAt: null,
      expiresAt: { gt: new Date() }
    }
  });
  if (!recovery) throw new AppError(400, 'Invalid or expired recovery token');

  if (await isPasswordBanned(newPassword)) {
    throw new AppError(400, 'Password is not allowed');
  }

  const hashed = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: recovery.userId },
      data: { password: hashed }
    }),
    prisma.accountRecovery.update({
      where: { id: recovery.id },
      data: { usedAt: new Date() }
    }),
    prisma.userSession.updateMany({
      where: { userId: recovery.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);
};

export const loginUser = async (
  email: string,
  password: string,
  ipAddress?: string
): Promise<LoginResult> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.disabled) return { ok: false, reason: 'disabled' };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return { ok: false, reason: 'wrong_password' };

  const authUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLogin: new Date(),
      // Signing in IS the answer to a dormancy warning (#279) — clearing the
      // stamp here is what makes the warning recoverable without staff.
      // Unconditional rather than guarded on non-null: a conditional would need
      // the current value, and writing null over null costs nothing.
      inactivityWarnedAt: null,
      ...(ipAddress ? { lastIp: ipAddress } : {})
    },
    select: authUserSelect
  });

  return { ok: true, user: toAuthUser(authUser) };
};
