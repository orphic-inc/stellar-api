/**
 * Seed deterministic accounts + invite tree for the Playwright E2E suite.
 *
 * stellar-ui's e2e harness logs in as a regular user and a staff user (by
 * email — POST /api/auth) and exercises real surfaces against this DB. A bare
 * pair of empty users would let invite-tree assertions pass on the empty-state
 * branch alone (testing theater); so this also builds a fixed invite subtree
 * UNDER testuser — direct invitees, a nested invitee (depth), plus a donor and
 * a disabled node — so GET /users/:id/invite-tree returns something real to
 * assert against. The fixture usernames below are the contract the e2e relies
 * on; keep them in sync with stellar-ui/e2e/invite.spec.ts.
 *
 * Idempotent — re-running updates the fixtures in place (no duplicates).
 * Requires ranks to exist (run `npm run db:seed` first). Credentials come from
 * the same env vars stellar-ui's e2e uses; defaults match its .env.example.
 *
 * Lives under src/ (not prisma/scripts/) so tsc compiles it into the image —
 * a deployed container stack can seed its own e2e fixtures without a ts-node
 * toolchain or an exposed database port.
 *
 * Run:
 *   npm run db:seed-e2e                        # dev, from source
 *   node dist/scripts/seed-e2e-users.js        # inside the container
 *   TEST_USER_EMAIL=qa@stellar.test TEST_USER_PASSWORD=hunter2 npm run db:seed-e2e
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const REGULAR = {
  username: process.env.TEST_USER ?? 'testuser',
  email: (process.env.TEST_USER_EMAIL ?? 'testuser@example.com').toLowerCase(),
  password: process.env.TEST_USER_PASSWORD ?? 'changeme'
};
const STAFF = {
  username: process.env.TEST_STAFF_USER ?? 'staffuser',
  email: (
    process.env.TEST_STAFF_EMAIL ?? 'staffuser@example.com'
  ).toLowerCase(),
  password: process.env.TEST_STAFF_PASSWORD ?? 'changeme'
};

const GB = (n: number): bigint => BigInt(n) * 1_073_741_824n;

interface UpsertArgs {
  username: string;
  email: string;
  password: string;
  rankLevel: number;
  contributed?: bigint;
  consumed?: bigint;
  isDonor?: boolean;
  disabled?: boolean;
}

/** Idempotently create or refresh a user (with its required 1:1 settings + profile). */
async function upsertUser(a: UpsertArgs): Promise<number> {
  const rank = await prisma.userRank.findFirst({
    where: { level: a.rankLevel }
  });
  if (!rank) {
    throw new Error(
      `No UserRank at level ${a.rankLevel}. Run \`npm run db:seed\` first.`
    );
  }

  const hashed = await bcrypt.hash(a.password, await bcrypt.genSalt(10));

  const data = {
    email: a.email,
    password: hashed,
    userRankId: rank.id,
    contributed: a.contributed ?? 0n,
    consumed: a.consumed ?? 0n,
    isDonor: a.isDonor ?? false,
    disabled: a.disabled ?? false
  };

  const existing = await prisma.user.findUnique({
    where: { username: a.username },
    select: { id: true }
  });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data });
    return existing.id;
  }

  const settings = await prisma.userSettings.create({ data: {} });
  const profile = await prisma.profile.create({ data: {} });
  const created = await prisma.user.create({
    data: {
      username: a.username,
      ...data,
      userSettingsId: settings.id,
      profileId: profile.id
    },
    select: { id: true }
  });
  return created.id;
}

/** Point `userId`'s adjacency edge at `inviterId` (null = tree root). */
async function setInviter(
  userId: number,
  inviterId: number | null
): Promise<void> {
  await prisma.inviteTree.upsert({
    where: { userId },
    create: { userId, inviterId },
    update: { inviterId }
  });
}

async function main(): Promise<void> {
  // These fixtures are minted with known, weak default credentials
  // (testuser/changeme). Compiling the script into the image means it ships to
  // every deployment, so refuse to run against a production environment unless
  // the operator explicitly opts in — throwaway and staging stacks only.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_E2E_SEED !== 'true'
  ) {
    throw new Error(
      'Refusing to seed e2e fixtures with NODE_ENV=production: these accounts use known default credentials. Set ALLOW_E2E_SEED=true to override (throwaway/staging stacks only).'
    );
  }

  const testuserId = await upsertUser({ ...REGULAR, rankLevel: 100 });
  const staffuserId = await upsertUser({ ...STAFF, rankLevel: 500 });

  // A fixed subtree under testuser so the invite-tree surface has real data:
  //   testuser
  //   ├── e2e_alpha   (donor)
  //   │   └── e2e_charlie   (depth 2)
  //   ├── e2e_bravo
  //   └── e2e_delta   (disabled)
  const alphaId = await upsertUser({
    username: 'e2e_alpha',
    email: 'e2e_alpha@example.com',
    password: 'changeme',
    rankLevel: 100,
    contributed: GB(30),
    consumed: GB(10),
    isDonor: true
  });
  const bravoId = await upsertUser({
    username: 'e2e_bravo',
    email: 'e2e_bravo@example.com',
    password: 'changeme',
    rankLevel: 100,
    contributed: GB(5),
    consumed: GB(10)
  });
  const charlieId = await upsertUser({
    username: 'e2e_charlie',
    email: 'e2e_charlie@example.com',
    password: 'changeme',
    rankLevel: 100,
    contributed: GB(12),
    consumed: GB(4)
  });
  const deltaId = await upsertUser({
    username: 'e2e_delta',
    email: 'e2e_delta@example.com',
    password: 'changeme',
    rankLevel: 100,
    disabled: true
  });

  await setInviter(testuserId, null);
  await setInviter(alphaId, testuserId);
  await setInviter(bravoId, testuserId);
  await setInviter(charlieId, alphaId);
  await setInviter(deltaId, testuserId);

  console.log('Seeded e2e fixtures:');
  console.log(
    `  regular: ${REGULAR.username} <${REGULAR.email}> (id ${testuserId})`
  );
  console.log(
    `  staff:   ${STAFF.username} <${STAFF.email}> (id ${staffuserId})`
  );
  console.log(
    `  invite subtree under ${REGULAR.username}: e2e_alpha(+donor) → e2e_charlie, e2e_bravo, e2e_delta(disabled)`
  );
}

main()
  .catch((err: unknown) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`Prisma error ${err.code}: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
