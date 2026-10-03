/**
 * A report opens the release it concerns, for `reports_manage` (#905,
 * ADR-0055 §3), against a real database: a closed community, staff who hold no
 * role in it, and reports in each state.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  CommentPage,
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseType,
  ReportStatus,
  ReportTargetType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { auth as authConfig } from '../modules/config';
import { listReports } from '../modules/reports';
import app from '../app';

let uploaderId: number;
let staffId: number;
let moderatorId: number;
let communityId: number;
let releaseId: number;
let otherReleaseId: number;
let contributionId: number;

// The app limits mutations to 30 a minute per client IP; each test gets its own.
let clientIp = '';
let ipCount = 0;

const session = (userId: number) => ({
  Cookie: `token=${jwt.sign({ user: { id: userId } }, authConfig.jwtSecret, {
    expiresIn: 60
  })}`,
  'X-Forwarded-For': clientIp
});

const makeUser = async (username: string, userRankId: number) => {
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const user = await testPrisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      password: 'x',
      avatar: '',
      userRankId,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  return user.id;
};

const makeRelease = (title: string) =>
  testPrisma.release.create({
    data: {
      title,
      description: 'd',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020,
      communityId
    }
  });

const fileReport = (
  targetType: ReportTargetType,
  targetId: number,
  status: ReportStatus = ReportStatus.Open
) =>
  testPrisma.report.create({
    data: {
      reporterId: uploaderId,
      targetType,
      targetId,
      category: 'other',
      reason: 'test',
      status
    }
  });

const releasePath = (id: number) =>
  `/communities/${communityId}/releases/${id}`;

/** The release page's two reads, as `viewer`. */
const readPage = async (viewer: number, id = releaseId) => {
  const [detail, contributions] = await Promise.all([
    request(app)
      .get(`/api${releasePath(id)}`)
      .set(session(viewer)),
    request(app)
      .get(`/api${releasePath(id)}/contributions`)
      .set(session(viewer))
  ]);
  return { detail, contributions };
};

const queueLinks = async () =>
  (
    await listReports({
      page: 1,
      status: 'all',
      targetType: 'all',
      claimedByMe: false,
      staffUserId: staffId
    })
  ).reports.map((r) => r.sourceUrl);

beforeEach(async () => {
  ipCount += 1;
  clientIp = `10.3.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`;
  await truncateAll();
  await seedDefaults();
  // The install barrier answers 503 to every route until this is stamped.
  await testPrisma.siteSettings.create({
    data: { id: 1, dismissedLaunchChecklist: [], installedAt: new Date() }
  });
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const staffRank = await testPrisma.userRank.create({
    data: { level: 500, name: 'Staff', permissions: { reports_manage: true } }
  });
  const moderatorRank = await testPrisma.userRank.create({
    data: {
      level: 400,
      name: 'Moderator',
      permissions: { communities_manage: true }
    }
  });
  uploaderId = await makeUser('uploader', rank.id);
  staffId = await makeUser('staff', staffRank.id);
  moderatorId = await makeUser('moderator', moderatorRank.id);

  const community = await testPrisma.community.create({
    data: {
      name: 'Closed',
      image: '',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.closed,
      consumers: { create: { userId: uploaderId } }
    }
  });
  communityId = community.id;
  releaseId = (await makeRelease('reported')).id;
  otherReleaseId = (await makeRelease('neighbour')).id;

  const edition = await testPrisma.edition.create({ data: { releaseId } });
  const contributor = await testPrisma.contributor.create({
    data: { userId: uploaderId, communities: { connect: { id: communityId } } }
  });
  contributionId = (
    await testPrisma.contribution.create({
      data: {
        userId: uploaderId,
        releaseId,
        contributorId: contributor.id,
        editionId: edition.id,
        type: FileType.flac,
        downloadUrl: 'https://example.com/file.torrent',
        sizeInBytes: 1000,
        approvedAccountingBytes: BigInt(1000),
        releaseDescription: 'test'
      }
    })
  ).id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('a report opens the release it concerns (ADR-0055 §3)', () => {
  it('stays closed to staff while no report concerns it', async () => {
    const { detail, contributions } = await readPage(staffId);
    expect(detail.status).toBe(403);
    expect(contributions.status).toBe(403);
  });

  const commentOn = {
    release: () =>
      testPrisma.comment.create({
        data: {
          page: CommentPage.release,
          releaseId,
          authorId: uploaderId,
          body: 'c'
        }
      }),
    contribution: () =>
      testPrisma.comment.create({
        data: {
          page: CommentPage.contributions,
          contributionId,
          authorId: uploaderId,
          body: 'c'
        }
      })
  };

  it.each([
    ['the release', () => fileReport(ReportTargetType.Release, releaseId)],
    [
      'one of its contributions',
      () => fileReport(ReportTargetType.Contribution, contributionId)
    ],
    [
      "a comment in the release's thread",
      async () =>
        fileReport(ReportTargetType.Comment, (await commentOn.release()).id)
    ],
    [
      "a comment in a contribution's thread",
      async () =>
        fileReport(
          ReportTargetType.Comment,
          (await commentOn.contribution()).id
        )
    ]
  ])('opens the page for a report against %s', async (_, file) => {
    await file();

    const { detail, contributions } = await readPage(staffId);

    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(releaseId);
    expect(contributions.status).toBe(200);
    expect(contributions.body.map((c: { id: number }) => c.id)).toEqual([
      contributionId
    ]);
    expect(await queueLinks()).toEqual([releasePath(releaseId)]);
  });

  it('opens it while the report is claimed', async () => {
    await fileReport(ReportTargetType.Release, releaseId, ReportStatus.Claimed);
    expect((await readPage(staffId)).detail.status).toBe(200);
  });

  it('opens it read-only, without the download URL', async () => {
    await fileReport(ReportTargetType.Release, releaseId);

    const { detail, contributions } = await readPage(staffId);

    expect(detail.status).toBe(200);
    expect(contributions.body[0]).not.toHaveProperty('downloadUrl');
    const edit = await request(app)
      .put(`/api${releasePath(releaseId)}`)
      .set(session(staffId))
      .send({ title: 'changed' });
    expect(edit.status).toBe(403);
  });

  // No reader gets it from this list, the uploader included (#908): their
  // own uploads list carries it, and the grant hands it to everyone else.
  it('gives the uploader no download URL here either', async () => {
    const { contributions } = await readPage(uploaderId);
    expect(contributions.status).toBe(200);
    expect(contributions.body[0]).not.toHaveProperty('downloadUrl');
  });

  it('closes again, with its link, once the report is resolved', async () => {
    await fileReport(
      ReportTargetType.Release,
      releaseId,
      ReportStatus.Resolved
    );

    const { detail, contributions } = await readPage(staffId);

    expect(detail.status).toBe(403);
    expect(contributions.status).toBe(403);
    expect(await queueLinks()).toEqual([null]);
  });

  it('opens no other release in the same community', async () => {
    await fileReport(ReportTargetType.Release, releaseId);

    const { detail, contributions } = await readPage(staffId, otherReleaseId);

    expect(detail.status).toBe(403);
    expect(contributions.status).toBe(403);
  });

  it('grants no download', async () => {
    await fileReport(ReportTargetType.Contribution, contributionId);

    const grant = await request(app)
      .post(`/api/contributions/${contributionId}/access`)
      .set(session(staffId))
      .send({});

    expect(grant.status).toBe(404);
  });

  it('opens nothing for staff without reports_manage', async () => {
    await fileReport(ReportTargetType.Release, releaseId);

    const { detail, contributions } = await readPage(moderatorId);

    expect(detail.status).toBe(403);
    expect(contributions.status).toBe(403);
  });
});
