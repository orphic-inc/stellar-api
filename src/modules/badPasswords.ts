import { PrismaClient } from '@prisma/client';
import { DEFAULTS as SITE_SETTINGS_DEFAULTS } from './settings';

/**
 * The shipped password denylist (#536).
 *
 * `BadPassword` has been consulted on three auth paths since it was written —
 * registration and both password-change flows — but nothing ever wrote a row,
 * so `isPasswordBanned` returned `false` on every call in every deployment. The
 * enforcement was live and the control was empty. This module supplies the
 * missing half.
 *
 * **Scope, stated honestly.** This is a list of notorious passwords, not a
 * strength estimator. It blocks `123456` and `password`; it does not block
 * `dragon7`, and it does not change the `min(6)` floor on registration
 * (`src/schemas/auth.ts`). Making a dead control live is not the same as making
 * passwords strong.
 *
 * Every entry is at least six characters. Anything shorter is unreachable:
 * `min(6)` is the floor on both creation paths (`src/schemas/auth.ts`,
 * `src/schemas/user.ts`) and install is `min(8)`, so a five-character entry
 * could never be submitted to match against. Twenty-four such entries were
 * dropped rather than shipped — a denylist padded with rows that cannot fire
 * overstates its own coverage, which is the failure this issue is about.
 *
 * Entries are lowercase by construction and asserted so by the spec — the
 * lookup lowercases its candidate, so a mixed-case entry here would be
 * unreachable rather than merely redundant.
 */
export const COMMON_BAD_PASSWORDS: readonly string[] = [
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  '121212',
  '123123',
  '654321',
  '666666',
  '112233',
  '789456',
  '159753',
  '987654321',
  '11111111',
  '00000000',
  '222222',
  '333333',
  '555555',
  '777777',
  '888888',
  '999999',
  '101010',
  '123321',
  '456789',
  '147258',
  '852456',
  '963852',
  '1q2w3e4r',
  '1qaz2wsx',
  'qwe123',
  'abc123',
  'a123456',
  '123abc',
  'asd123',
  'zxc123',
  '1q2w3e',
  'qwerty',
  'qwertyui',
  'qwerty123',
  'asdfgh',
  'asdfghjk',
  'zxcvbn',
  'zxcvbnm',
  'qazwsx',
  'qwertyuiop',
  'poiuytrewa',
  'mnbvcxz',
  'azerty',
  '1qazxsw2',
  'qweasdzxc',
  'q1w2e3r4',
  'qwer1234',
  'asdf1234',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'passwd',
  'secret',
  'letmein',
  'welcome',
  'welcome1',
  'administrator',
  'test123',
  'changeme',
  'default',
  'temporary',
  'access',
  'master',
  'manager',
  'superuser',
  'sysadmin',
  'operator',
  'username',
  'sample',
  'trustno1',
  'iloveyou',
  'starwars',
  'whatever',
  'nothing',
  'unknown',
  'anything',
  'dragon',
  'monkey',
  'football',
  'baseball',
  'basketball',
  'soccer',
  'hockey',
  'superman',
  'batman',
  'spiderman',
  'pokemon',
  'charlie',
  'jordan',
  'harley',
  'ranger',
  'hunter',
  'buster',
  'thomas',
  'robert',
  'daniel',
  'michael',
  'michelle',
  'jennifer',
  'jessica',
  'ashley',
  'amanda',
  'joshua',
  'matthew',
  'andrew',
  'anthony',
  'william',
  'nicole',
  'hannah',
  'samantha',
  'jasmine',
  'summer',
  'chelsea',
  'george',
  'patrick',
  'justin',
  'taylor',
  'austin',
  'maggie',
  'sunshine',
  'princess',
  'flower',
  'butterfly',
  'chocolate',
  'cookie',
  'angels',
  'babygirl',
  'lovely',
  'loveme',
  'iloveu',
  'forever',
  'freedom',
  'liberty',
  'america',
  'canada',
  'england',
  'ireland',
  'fuckyou',
  'fuckoff',
  'fuckme',
  'asshole',
  'bullshit',
  'whocares',
  'nopass',
  'nopassword',
  'blahblah',
  'boobies',
  'sexsex',
  'tigger',
  'shadow',
  'pepper',
  'ginger',
  'cookie1',
  'kitten',
  'purple',
  'orange',
  'yellow',
  'silver',
  'golden',
  'diamond',
  'phoenix',
  'falcon',
  'panther',
  'cowboy',
  'harley1',
  'mercedes',
  'ferrari',
  'porsche',
  'corvette',
  'mustang',
  'yamaha',
  'toyota',
  'nissan',
  'camaro',
  'jaguar',
  'summer1',
  'winter',
  'spring',
  'autumn',
  'january',
  'february',
  'december',
  'monday',
  'friday',
  'sunday',
  'holiday',
  'birthday',
  'newyear',
  'christmas',
  'halloween',
  'easter',
  'internet',
  'computer',
  'server',
  'database',
  'network',
  'system',
  'windows',
  'ubuntu',
  'android',
  'iphone',
  'google',
  'facebook',
  'twitter',
  'youtube',
  'hotmail',
  'myspace',
  'tumblr',
  'reddit',
  'discord',
  'minecraft',
  'fortnite',
  'runescape',
  'warcraft',
  'diablo',
  'counterstrike',
  'halflife',
  'guitar',
  'drummer',
  'metallica',
  'nirvana',
  'slipknot',
  'greenday',
  'blink182',
  'linkinpark',
  'eminem',
  'rammstein'
];

/**
 * The site's canonical password normalisation.
 *
 * Case is the only thing folded. Whitespace is deliberately significant — a
 * leading space makes a different password, and silently trimming would deny
 * one the user could still type. Variant folding (`p@ssw0rd` -> `password`) is
 * out of scope: it produces false positives on genuinely strong passwords and
 * makes the refusal impossible to explain. Anything it would catch is caught
 * here only by being listed literally, and several such variants are.
 */
export const normalizePassword = (password: string): string =>
  password.toLowerCase();

/**
 * Idempotent seed, guarded by a recorded fact rather than a row count.
 *
 * `SiteSettings.badPasswordsSeededAt` is stamped the first time this runs, and
 * a stamped marker makes every later run a no-op. Counting `bad_passwords` rows
 * instead would be wrong in the way ADR-0022 describes for install state: staff
 * are free to delete seeded entries they disagree with, and a count-based guard
 * would resurrect the entire list on the next container boot, silently undoing
 * a deliberate moderation decision. `installedAt` exists for exactly this
 * reason, and `seedGoldenRules` records a second instance of the same trap.
 *
 * Rows are written `SEEDED` so a later reconcile can tell them from curated
 * ones; staff additions default to `STAFF` at the schema level.
 *
 * `skipDuplicates` covers the case where a staff member has already added an
 * entry this list also contains — the unique constraint on `password` would
 * otherwise abort the whole seed over one collision.
 */
export async function seedBadPasswords(client: PrismaClient): Promise<void> {
  const settings = await client.siteSettings.findUnique({
    where: { id: 1 },
    select: { badPasswordsSeededAt: true }
  });
  if (settings?.badPasswordsSeededAt) return;

  await client.badPassword.createMany({
    data: COMMON_BAD_PASSWORDS.map((password) => ({
      password: normalizePassword(password),
      source: 'SEEDED' as const
    })),
    skipDuplicates: true
  });

  // Upsert, not update. On a fresh database `seedAll` frequently runs before
  // anything has touched site settings — the row is created lazily by
  // `getSettings`/`markInstalled` and no migration plants it — so an update
  // here would throw, or a bare `findFirst` guard would return null and make
  // this a silent no-op. That is precisely the failure this module exists to
  // fix, so it must not be reintroduced by the fix.
  const badPasswordsSeededAt = new Date();
  await client.siteSettings.upsert({
    where: { id: 1 },
    create: { ...SITE_SETTINGS_DEFAULTS, badPasswordsSeededAt },
    update: { badPasswordsSeededAt }
  });
}
