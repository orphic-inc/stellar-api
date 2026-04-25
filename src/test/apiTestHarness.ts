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
