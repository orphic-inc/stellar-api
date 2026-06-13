/**
 * Delegated IRC SASL validation (ADR-0011). Ergo calls the internal endpoint
 * per login with `account = userId`, `password = IRCKey`; this module is the
 * single source of truth for the credential — the IRCd holds no mirror.
 *
 * Rotation is instantly effective: a rotated ircKey simply stops matching the
 * stored value. Disabled accounts and members who never enrolled (null ircKey)
 * are rejected.
 */
import { prisma } from '../lib/prisma';
import { secureCompare } from '../lib/secureCompare';

export interface SaslResult {
  ok: boolean;
  userId?: number;
}

export const validateSasl = async (
  account: string,
  key: string
): Promise<SaslResult> => {
  const userId = Number(account);
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, ircKey: true, disabled: true }
  });

  if (!user || user.disabled || !user.ircKey) return { ok: false };
  if (!secureCompare(key, user.ircKey)) return { ok: false };

  return { ok: true, userId: user.id };
};
