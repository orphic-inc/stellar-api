jest.mock('../modules/installState', () => ({
  isInstalled: jest.fn()
}));

jest.mock('../modules/profile', () => ({
  getCurrentProfile: jest.fn(),
  updateProfile: jest.fn(),
  createInvite: jest.fn()
}));

jest.mock('../modules/contribution', () => ({
  createContributionSubmission: jest.fn()
}));

jest.mock('../modules/downloads', () => ({
  grantDownloadAccess: jest.fn(),
  reverseDownloadAccess: jest.fn()
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
  getUnreadCount: jest.fn()
}));

jest.mock('../modules/staffInbox', () => ({
  listStaffTickets: jest.fn(),
  listMyTickets: jest.fn(),
  createTicket: jest.fn(),
  viewTicket: jest.fn(),
  replyToTicket: jest.fn(),
  assignTicket: jest.fn(),
  resolveTicket: jest.fn(),
  unresolveTicket: jest.fn(),
  bulkResolveTickets: jest.fn(),
  listResponses: jest.fn(),
  createResponse: jest.fn(),
  updateResponse: jest.fn(),
  deleteResponse: jest.fn(),
  getStaffUnreadCount: jest.fn()
}));

jest.mock('../modules/config', () => ({
  auth: { jwtSecret: 'x'.repeat(32) },
  http: { port: 8080, corsOrigin: 'http://localhost:3000' },
  logging: { level: 'error', timestampFormat: undefined },
  economy: { minimumBounty: 104857600 }
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
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    userRank: {
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    userSettings: {
      create: jest.fn()
    },
    profile: {
      create: jest.fn()
    },
    forum: {
      findMany: jest.fn(),
      findUnique: jest.fn()
    },
    forumTopic: {
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    forumPost: {
      findFirst: jest.fn()
    },
    forumTopicNote: {
      findUnique: jest.fn(),
      delete: jest.fn()
    },
    post: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    },
    postComment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn()
    },
    comment: {
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn()
    },
    subscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn()
    },
    commentSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn()
    },
    auditLog: {
      create: jest.fn()
    },
    request: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    contribution: {
      findUnique: jest.fn()
    },
    downloadAccessGrant: {
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    collage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn()
    },
    collageEntry: {
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    collageSubscription: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    bookmarkCollage: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    },
    release: {
      findUnique: jest.fn()
    },
    privateConversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn()
    },
    privateConversationParticipant: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    privateMessage: {
      create: jest.fn()
    },
    staffInboxConversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    staffInboxMessage: {
      create: jest.fn()
    },
    staffInboxResponse: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    report: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    reportNote: {
      create: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (value: string) => value,
  sanitizePlain: (value: string) => value
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { isInstalled } from '../modules/installState';
import { prisma } from '../lib/prisma';
import { createInvite, updateProfile } from '../modules/profile';
import { createContributionSubmission } from '../modules/contribution';
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
  createTopicNote
} from '../modules/forum';
import {
  grantDownloadAccess,
  reverseDownloadAccess
} from '../modules/downloads';
import * as pmModule from '../modules/pm';
import * as staffInboxModule from '../modules/staffInbox';

export { app, request };

export const mockedIsInstalled = isInstalled as jest.MockedFunction<
  typeof isInstalled
>;
export const prismaMock = prisma as unknown as {
  user: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  userRank: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  userSettings: {
    create: jest.Mock;
  };
  profile: {
    create: jest.Mock;
  };
  forum: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
  forumTopic: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  forumPost: {
    findFirst: jest.Mock;
  };
  forumTopicNote: {
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
  post: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  postComment: {
    create: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
  comment: {
    update: jest.Mock;
    create: jest.Mock;
    findUnique: jest.Mock;
  };
  subscription: {
    upsert: jest.Mock;
    deleteMany: jest.Mock;
    findMany: jest.Mock;
  };
  commentSubscription: {
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  notification: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
  request: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  contribution: {
    findUnique: jest.Mock;
  };
  downloadAccessGrant: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  collage: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  collageEntry: {
    findUnique: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  collageSubscription: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  bookmarkCollage: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  release: {
    findUnique: jest.Mock;
  };
  privateConversation: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
  };
  privateConversationParticipant: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  privateMessage: {
    create: jest.Mock;
  };
  staffInboxConversation: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  staffInboxMessage: {
    create: jest.Mock;
  };
  staffInboxResponse: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  report: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  reportNote: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};
export const bcryptMock = bcrypt as unknown as {
  compare: jest.Mock;
};
export const createInviteMock = createInvite as jest.MockedFunction<
  typeof createInvite
>;
export const updateProfileMock = updateProfile as jest.MockedFunction<
  typeof updateProfile
>;
export const createContributionSubmissionMock =
  createContributionSubmission as jest.MockedFunction<
    typeof createContributionSubmission
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
export const deletePostMock = deletePost as jest.MockedFunction<
  typeof deletePost
>;
export const createTopicNoteMock = createTopicNote as jest.MockedFunction<
  typeof createTopicNote
>;
export const grantDownloadAccessMock =
  grantDownloadAccess as jest.MockedFunction<typeof grantDownloadAccess>;
export const reverseDownloadAccessMock =
  reverseDownloadAccess as jest.MockedFunction<typeof reverseDownloadAccess>;
export const pmMock = pmModule as jest.Mocked<typeof pmModule>;
export const staffInboxMock = staffInboxModule as jest.Mocked<
  typeof staffInboxModule
>;

export const setCurrentUserRankLevel = (level: number): void => {
  currentUserRankLevel = level;
};

export const resetApiTestState = (): void => {
  jest.clearAllMocks();
  mockedIsInstalled.mockResolvedValue(true);
  currentUserRankLevel = 1000;
  prismaMock.userRank.findUnique.mockResolvedValue({ permissions: {} });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return arg({
        userSettings: prismaMock.userSettings,
        profile: prismaMock.profile,
        user: prismaMock.user
      });
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
};
