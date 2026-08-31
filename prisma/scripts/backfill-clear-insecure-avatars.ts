/**
 * One-off backfill: clear stored avatar URLs the schema no longer admits (#396).
 *
 * `avatar` was a bare `z.string().url()` — and on `PUT /api/users/settings`, not
 * even that — so plain `http:` and `ftp:` URLs are stored today. #396 narrowed
 * both write paths to https-only or an `/api/asset/<sha256>` path, which stops
 * NEW ones arriving but leaves the existing rows rendering: a value a member can
 * no longer save, still fetched by every viewer of their profile and posts.
 *
 * Deliberately NOT a migration. Nulling an avatar is a visible change to someone
 * else's account, so it stays an operator decision run by hand, the way
 * backfill-remove-gravatar-avatars.ts does the same job for the same reason.
 *
 * Scope note: this clears only what is now INVALID. Remote `https:` avatars are
 * untouched — they remain a supported form, and the IP/timing disclosure they
 * carry (#361) is narrowed by https rather than closed. Closing it needs the
 * CSP's `img-src`, which stays open by ADR-0031 §6 and is tracked in #457.
 *
 * Both columns, because there are two and nothing reconciles them:
 * `User.avatar` is what PUT /api/users/settings writes, `Profile.avatar` what
 * PUT /api/profile/me writes.
 *
 * Idempotent — re-running is a no-op once the URLs are cleared.
 *
 * Run:  npx ts-node prisma/scripts/backfill-clear-insecure-avatars.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Anything carrying an explicit non-https scheme. Matched positively rather
  // than as "not https", so a stored value that is not a URL at all — the dev
  // generator's `seeded` sentinel, or the empty string — is left alone.
  const INSECURE_SCHEMES = ['http://', 'ftp://', 'ftps://', 'javascript:'];

  const where = {
    OR: INSECURE_SCHEMES.map((scheme) => ({
      avatar: { startsWith: scheme }
    }))
  };

  const [users, profiles] = await prisma.$transaction([
    prisma.user.updateMany({ where, data: { avatar: null } }),
    prisma.profile.updateMany({ where, data: { avatar: null } })
  ]);

  console.log(
    `Cleared insecure avatars — ${users.count} user(s), ${profiles.count} profile(s).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
