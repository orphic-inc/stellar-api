import { prisma } from '../lib/prisma';

/**
 * Email blacklist enforcement (#540).
 *
 * `EmailBlacklist` shipped with a full admin surface — CRUD routes, a dedicated
 * `email_blacklist_manage` permission and OpenAPI registration — and **nothing
 * ever read it**. Staff could add an entry, receive a 201, see it in the list,
 * and it did nothing. That is worse than the `BadPassword` gap it mirrors
 * (#536): there, the control failed silently with no affordance; here every
 * signal told a moderator the ban was in force.
 *
 * This module is the missing read side.
 */

/**
 * The site's canonical email normalisation, matching registration.
 *
 * `registerUser` stores `email.toLowerCase()` and compares the same way
 * (`modules/auth.ts`), so the blacklist folds case identically. Without this a
 * staff entry of `Spam@Example.com` would be stored and never matched.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/**
 * The blacklist keys a given address should be tested against.
 *
 * An entry is either a full address or a bare domain — the shape the admin
 * route's own validation message has always promised ("Email or domain is
 * required"). So `user@spam.example` is blocked by an entry of
 * `user@spam.example` *or* one of `spam.example`.
 *
 * Deliberately literal: `example.com` does **not** match `@mail.example.com`.
 * Subdomain wildcarding silently widens a ban past what the moderator typed,
 * and staff can add both entries when they want both.
 *
 * Returning the keys as an array is what lets the lookup be two exact matches
 * against the existing `@@index([email])` rather than a `LIKE` scan.
 */
export const blacklistKeysFor = (email: string): string[] => {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return [normalized];
  return [normalized, normalized.slice(at + 1)];
};

/** Shape a blacklist entry must have to be capable of matching anything. */
const ADDRESS = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
const DOMAIN = /^[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Can this entry ever match an address?
 *
 * Used by the admin route to refuse entries that would sit in the table doing
 * nothing — the same reasoning that dropped 24 unreachable rows from the
 * password denylist. An entry of `known spammer` is accepted by a bare
 * `z.string().min(1)` and can never fire, which is this issue's own bug in
 * miniature.
 */
export const isMatchableBlacklistEntry = (entry: string): boolean => {
  const value = normalizeEmail(entry);
  return ADDRESS.test(value) || DOMAIN.test(value);
};

/**
 * Is this address blocked, by a full-address entry or by its domain?
 *
 * Two exact lookups via `IN`, both served by the `email` index. The rows are
 * normalised on write and by migration, so no case folding is needed in the
 * query itself.
 */
export const isEmailBlacklisted = async (email: string): Promise<boolean> => {
  const found = await prisma.emailBlacklist.findFirst({
    where: { email: { in: blacklistKeysFor(email) } },
    select: { id: true }
  });
  return !!found;
};
