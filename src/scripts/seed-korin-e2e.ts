/**
 * Fixtures for the korin end-to-end run of private-community announce delivery
 * (#328, ADR-0030; korin ADR-007). korin's driver,
 * `packages/irc-bridge/smoke/private-channels.ts` in obrien-k/korin-pink, calls
 * this through `npm run e2e:korin -- <command>` while this API runs against the
 * same database, projecting and announcing to korin's e2e stack.
 *
 *   seed                                   baseline (seedAll) plus the cast; prints ids
 *   contribute <communityId>               one new contribution, which triggers an announce
 *   remove-consumer <communityId> <user>   drop a member, which triggers a kick
 *   set-private <communityId>              flip a community's announces to PRIVATE
 *
 * The cast, which the korin driver relies on: alice (nick `alice`), bob (`bob`),
 * carol (no verified nick) and dave (`dave`, in no community), and three
 * communities, in this order:
 *   1 Private Club (PRIVATE; alice, bob, carol)
 *   2 Squat Club   (PUBLIC until flipped; alice)
 *   3 Open House   (PUBLIC; alice)
 *
 * **It refuses any database not named `stellar_e2e`.** It creates users and
 * rewrites memberships, so it must never reach a dev or production database by
 * accident. Create that database, run `npx prisma migrate deploy` against it,
 * then `seed`, and drop it when done.
 */
import {
  PrismaClient,
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseType
} from '@prisma/client';
import { seedAll } from '../modules/seedAll';

const url = process.env.STELLAR_PSQL_URI ?? '';
if (!/\/stellar_e2e(\?|$)/.test(url))
  throw new Error('refusing: STELLAR_PSQL_URI is not the stellar_e2e database');
const prisma = new PrismaClient();

async function user(username: string, ircNick: string | null) {
  const rank = await prisma.userRank.findFirstOrThrow({
    where: { secondary: false },
    orderBy: { level: 'asc' }
  });
  const settings = await prisma.userSettings.create({ data: {} });
  const profile = await prisma.profile.create({ data: {} });
  return prisma.user.create({
    data: {
      username,
      email: `${username}@e2e.test`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      ircNick,
      inviteTree: { create: { inviterId: null } }
    }
  });
}

async function community(
  name: string,
  announceVisibility: 'PUBLIC' | 'PRIVATE',
  consumerIds: number[]
) {
  const c = await prisma.community.create({
    data: {
      name,
      image: '',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.closed,
      announceVisibility
    }
  });
  for (const userId of consumerIds) {
    await prisma.consumer.upsert({
      where: { userId },
      update: { communities: { connect: { id: c.id } } },
      create: { userId, communities: { connect: { id: c.id } } }
    });
  }
  const release = await prisma.release.create({
    data: {
      title: `${name} Album`,
      description: 'e2e',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2026,
      communityId: c.id
    }
  });
  await prisma.edition.create({ data: { releaseId: release.id } });
  return c.id;
}

async function seed() {
  await seedAll(prisma);
  const alice = await user('alice', 'alice');
  const bob = await user('bob', 'bob');
  const carol = await user('carol', null);
  const dave = await user('dave', 'dave');
  const privateClub = await community('Private Club', 'PRIVATE', [
    alice.id,
    bob.id,
    carol.id
  ]);
  const squatClub = await community('Squat Club', 'PUBLIC', [alice.id]);
  const openHouse = await community('Open House', 'PUBLIC', [alice.id]);
  console.log(
    JSON.stringify({ privateClub, squatClub, openHouse, dave: dave.id })
  );
}

async function contribute(a: string) {
  const communityId = Number(a);
  const release = await prisma.release.findFirstOrThrow({
    where: { communityId },
    include: { editions: true }
  });
  const alice = await prisma.user.findUniqueOrThrow({
    where: { username: 'alice' }
  });
  const contributor = await prisma.contributor.upsert({
    where: { userId: alice.id },
    update: { communities: { connect: { id: communityId } } },
    create: {
      userId: alice.id,
      communities: { connect: { id: communityId } }
    }
  });
  const types = [FileType.flac, FileType.mp3, FileType.aac, FileType.ogg];
  const n = await prisma.contribution.count({
    where: { releaseId: release.id }
  });
  const c = await prisma.contribution.create({
    data: {
      userId: alice.id,
      releaseId: release.id,
      contributorId: contributor.id,
      editionId: release.editions[0].id,
      type: types[n % types.length],
      downloadUrl: `https://e2e.test/${Date.now()}`,
      sizeInBytes: 1000,
      approvedAccountingBytes: BigInt(1000),
      releaseDescription: 'e2e'
    }
  });
  console.log(JSON.stringify({ contribution: c.id, release: release.title }));
}

async function removeConsumer(a: string, b: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { username: b } });
  await prisma.consumer.update({
    where: { userId: u.id },
    data: { communities: { disconnect: { id: Number(a) } } }
  });
  console.log('removed');
}

async function setPrivate(a: string) {
  await prisma.community.update({
    where: { id: Number(a) },
    data: { announceVisibility: 'PRIVATE' }
  });
  console.log('private');
}

const commands: Record<string, (a: string, b: string) => Promise<void>> = {
  seed,
  contribute,
  'remove-consumer': removeConsumer,
  'set-private': setPrivate
};

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const run = commands[cmd];
  if (!run) throw new Error(`unknown command ${cmd}`);
  await run(a, b);
}
main().finally(() => prisma.$disconnect());
