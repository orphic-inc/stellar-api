jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next()
);

jest.mock('../modules/installState', () => ({
  isInstalled: jest.fn()
}));

jest.mock('../modules/profile', () => ({
  getProfileById: jest.fn(),
  getProfileByLookup: jest.fn(),
  updateProfile: jest.fn(),
  createInvite: jest.fn()
}));

jest.mock('../modules/contribution', () => ({
  createContributionSubmission: jest.fn(),
  addContributionToRelease: jest.fn()
}));

jest.mock('../modules/downloads', () => ({
  grantDownloadAccess: jest.fn(),
  reverseDownloadAccess: jest.fn()
}));

jest.mock('../modules/reports', () => ({
  fileReport: jest.fn(),
  listReports: jest.fn(),
  getReport: jest.fn(),
  claimReport: jest.fn(),
  unclaimReport: jest.fn(),
  resolveReport: jest.fn(),
  addNote: jest.fn(),
  listMyReports: jest.fn(),
  getReportCounts: jest.fn(),
  getReportStats: jest.fn()
}));

jest.mock('../modules/linkHealth', () => ({
  recordContributionReport: jest.fn(),
  recheckStaleLinks: jest.fn()
}));

jest.mock('../modules/linkHealthJob', () => ({
  startLinkHealthJob: jest.fn()
}));

jest.mock('../modules/statsJob', () => ({
  startStatsJob: jest.fn()
}));

jest.mock('../modules/artist', () => ({
  createArtist: jest.fn(),
  updateArtist: jest.fn(),
  revertArtistFromHistory: jest.fn()
}));

jest.mock('../modules/user', () => ({
  getUserSettings: jest.fn(),
  updateUserSettings: jest.fn(),
  createUser: jest.fn()
}));

jest.mock('../modules/forum', () => ({
  createTopic: jest.fn(),
  updateTopic: jest.fn(),
  deleteTopic: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  deletePost: jest.fn(),
  deleteForum: jest.fn(),
  createPoll: jest.fn(),
  closePoll: jest.fn(),
  castVote: jest.fn(),
  createTopicNote: jest.fn()
}));

jest.mock('../modules/pm', () => ({
  listInbox: jest.fn(),
  listSentbox: jest.fn(),
  sendMessage: jest.fn(),
  replyToConversation: jest.fn(),
  viewConversation: jest.fn(),
  updateConversationFlags: jest.fn(),
  deleteConversation: jest.fn(),
  bulkUpdateConversations: jest.fn(),
  getUnreadCount: jest.fn(),
  createTicket: jest.fn(),
  listMyTickets: jest.fn(),
  listTicketQueue: jest.fn(),
  getTicketUnreadCount: jest.fn(),
  resolveTicket: jest.fn(),
  unresolveTicket: jest.fn(),
  assignTicket: jest.fn(),
  bulkResolveTickets: jest.fn()
}));

jest.mock('../modules/staffInbox', () => ({
  listResponses: jest.fn(),
  createResponse: jest.fn(),
  updateResponse: jest.fn(),
  deleteResponse: jest.fn()
}));

jest.mock('../modules/staff', () => ({
  getStaffList: jest.fn()
}));

jest.mock('../lib/mailer', () => ({
  sendInviteEmail: jest.fn().mockResolvedValue(true),
  sendRecoveryEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../modules/staffPm', () => ({
  createTicket: jest.fn(),
  listMyTickets: jest.fn(),
  listQueue: jest.fn(),
  getQueueCount: jest.fn(),
  viewTicket: jest.fn(),
  replyToTicket: jest.fn(),
  resolveTicket: jest.fn(),
  unresolveTicket: jest.fn(),
  assignTicket: jest.fn(),
  bulkResolve: jest.fn()
}));

jest.mock('../modules/config', () => ({
  auth: { jwtSecret: 'x'.repeat(32) },
  http: { port: 8080, corsOrigin: 'http://localhost:3000' },
  logging: { level: 'error', timestampFormat: undefined },
  economy: { minimumBounty: 104857600 },
  email: {
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    fromAddress: 'noreply@stellar.local',
    siteUrl: 'http://localhost:3000'
  }
}));

let currentUserRankLevel = 1000;

jest.mock('../middleware/auth', () => ({
  requireAuth: (
    req: { user?: { id: number; userRankLevel: number; userRankId: number } },
    _res: unknown,
    next: () => void
  ) => {
    req.user = { id: 7, userRankLevel: currentUserRankLevel, userRankId: 1 };
    next();
  }
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn()
}));

jest.mock('gravatar', () => ({
  url: jest.fn().mockReturnValue('https://gravatar.test/avatar.png')
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(
    (
      _payload: unknown,
      _secret: string,
      _options: unknown,
      callback: (err: Error | null, token?: string) => void
    ) => callback(null, 'signed-jwt')
  )
}));

jest.mock('../lib/prisma', () => ({
  prisma: jest.requireActual('jest-mock-extended').mockDeep()
}));

jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (value: string) => value,
  sanitizePlain: (value: string) => value
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { type DeepMockProxy } from 'jest-mock-extended';
import { type PrismaClient } from '@prisma/client';
import app from '../app';
import { isInstalled } from '../modules/installState';
import { prisma } from '../lib/prisma';
import {
  createInvite,
  updateProfile,
  getProfileById,
  getProfileByLookup
} from '../modules/profile';
import {
  createContributionSubmission,
  addContributionToRelease
} from '../modules/contribution';
import {
  createArtist,
  updateArtist,
  revertArtistFromHistory
} from '../modules/artist';
import {
  getUserSettings,
  updateUserSettings,
  createUser
} from '../modules/user';
import {
  createTopic,
  updateTopic,
  createPost,
  updatePost,
  deleteTopic,
  deletePost,
  deleteForum,
  createTopicNote,
  createPoll,
  closePoll,
  castVote
} from '../modules/forum';
import {
  grantDownloadAccess,
  reverseDownloadAccess
} from '../modules/downloads';
import { fileReport } from '../modules/reports';
import { recordContributionReport } from '../modules/linkHealth';

const gravatar = jest.requireMock('gravatar') as { url: jest.Mock };
import * as pmModule from '../modules/pm';
import * as staffInboxModule from '../modules/staffInbox';
import * as staffPmModule from '../modules/staffPm';
import { makeUserRank } from './factories';
export { makeUserRank } from './factories';

export { app, request };

export const mockedIsInstalled = isInstalled as jest.MockedFunction<
  typeof isInstalled
>;
export const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
export const bcryptMock = bcrypt as unknown as {
  compare: jest.Mock;
};

export const createInviteMock = createInvite as jest.MockedFunction<
  typeof createInvite
>;
export const getProfileByIdMock = getProfileById as jest.MockedFunction<
  typeof getProfileById
>;
export const getProfileByLookupMock = getProfileByLookup as jest.MockedFunction<
  typeof getProfileByLookup
>;
export const updateProfileMock = updateProfile as jest.MockedFunction<
  typeof updateProfile
>;
export const createContributionSubmissionMock =
  createContributionSubmission as jest.MockedFunction<
    typeof createContributionSubmission
  >;
export const addContributionToReleaseMock =
  addContributionToRelease as jest.MockedFunction<
    typeof addContributionToRelease
  >;
export const createArtistMock = createArtist as jest.MockedFunction<
  typeof createArtist
>;
export const updateArtistMock = updateArtist as jest.MockedFunction<
  typeof updateArtist
>;
export const revertArtistFromHistoryMock =
  revertArtistFromHistory as jest.MockedFunction<
    typeof revertArtistFromHistory
  >;
export const getUserSettingsMock = getUserSettings as jest.MockedFunction<
  typeof getUserSettings
>;
export const updateUserSettingsMock = updateUserSettings as jest.MockedFunction<
  typeof updateUserSettings
>;
export const createUserMock = createUser as jest.MockedFunction<
  typeof createUser
>;
export const createTopicMock = createTopic as jest.MockedFunction<
  typeof createTopic
>;
export const updateTopicMock = updateTopic as jest.MockedFunction<
  typeof updateTopic
>;
export const createPostMock = createPost as jest.MockedFunction<
  typeof createPost
>;
export const updatePostMock = updatePost as jest.MockedFunction<
  typeof updatePost
>;
export const deleteTopicMock = deleteTopic as jest.MockedFunction<
  typeof deleteTopic
>;
export const deleteForumMock = deleteForum as jest.MockedFunction<
  typeof deleteForum
>;
export const deletePostMock = deletePost as jest.MockedFunction<
  typeof deletePost
>;
export const createTopicNoteMock = createTopicNote as jest.MockedFunction<
  typeof createTopicNote
>;
export const createPollMock = createPoll as jest.MockedFunction<
  typeof createPoll
>;
export const closePollMock = closePoll as jest.MockedFunction<typeof closePoll>;
export const castVoteMock = castVote as jest.MockedFunction<typeof castVote>;
export const grantDownloadAccessMock =
  grantDownloadAccess as jest.MockedFunction<typeof grantDownloadAccess>;
export const reverseDownloadAccessMock =
  reverseDownloadAccess as jest.MockedFunction<typeof reverseDownloadAccess>;
export const fileReportMock = fileReport as jest.MockedFunction<
  typeof fileReport
>;
export const recordContributionReportMock =
  recordContributionReport as jest.MockedFunction<
    typeof recordContributionReport
  >;
export const pmMock = pmModule as jest.Mocked<typeof pmModule>;
export const staffInboxMock = staffInboxModule as jest.Mocked<
  typeof staffInboxModule
>;
export const staffPmMock = staffPmModule as jest.Mocked<typeof staffPmModule>;

export const setCurrentUserRankLevel = (level: number): void => {
  currentUserRankLevel = level;
};

export const resetApiTestState = (): void => {
  jest.clearAllMocks();
  mockedIsInstalled.mockResolvedValue(true);
  currentUserRankLevel = 1000;
  // Restore implementations cleared by resetMocks: true
  (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt');
  (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
  (gravatar.url as jest.Mock).mockReturnValue(
    'https://gravatar.test/avatar.png'
  );
  (jwt.sign as jest.Mock).mockImplementation(
    (
      _payload: unknown,
      _secret: string,
      _options: unknown,
      callback: (err: Error | null, token?: string) => void
    ) => callback(null, 'signed-jwt')
  );
  prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
  prismaMock.commentSubscription.findMany.mockResolvedValue([]);
  prismaMock.collageSubscription.findMany.mockResolvedValue([]);
  prismaMock.artistSubscription.findMany.mockResolvedValue([]);
  prismaMock.artistSubscription.findUnique.mockResolvedValue(null);
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
  prismaMock.siteSettings.upsert.mockResolvedValue({
    id: 1,
    approvedDomains: [],
    registrationStatus: 'open',
    maxUsers: 7000,
    dismissedLaunchChecklist: [],
    updatedAt: new Date()
  });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return arg(prismaMock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
};
