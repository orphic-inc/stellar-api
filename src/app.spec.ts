jest.mock('./modules/installState', () => ({
  isInstalled: jest.fn()
}));

jest.mock('./modules/profile', () => ({
  getCurrentProfile: jest.fn(),
  updateProfile: jest.fn(),
  createInvite: jest.fn()
}));

jest.mock('./modules/contribution', () => ({
  createContributionSubmission: jest.fn()
}));

jest.mock('./modules/user', () => ({
  getUserSettings: jest.fn(),
  updateUserSettings: jest.fn(),
  createUser: jest.fn()
}));

jest.mock('./modules/forum', () => ({
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

jest.mock('./modules/config', () => ({
  auth: { jwtSecret: 'x'.repeat(32) },
  http: { port: 8080, corsOrigin: 'http://localhost:3000' },
  logging: { level: 'error', timestampFormat: undefined }
}));

jest.mock('./middleware/auth', () => ({
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

jest.mock('./lib/prisma', () => ({
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
    $transaction: jest.fn()
  }
}));

jest.mock('./lib/sanitize', () => ({
  sanitizeHtml: (value: string) => value,
  sanitizePlain: (value: string) => value
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from './app';
import { isInstalled } from './modules/installState';
import { prisma } from './lib/prisma';
import { createInvite, updateProfile } from './modules/profile';
import { createContributionSubmission } from './modules/contribution';
import {
  getUserSettings,
  updateUserSettings,
  createUser
} from './modules/user';
import {
  createTopic,
  updateTopic,
  createPost,
  updatePost,
  deleteTopic,
  deletePost,
  createTopicNote
} from './modules/forum';

let currentUserRankLevel = 1000;

const mockedIsInstalled = isInstalled as jest.MockedFunction<
  typeof isInstalled
>;
const prismaMock = prisma as unknown as {
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
  $transaction: jest.Mock;
};
const bcryptMock = bcrypt as unknown as {
  compare: jest.Mock;
};
const createInviteMock = createInvite as jest.MockedFunction<
  typeof createInvite
>;
const updateProfileMock = updateProfile as jest.MockedFunction<
  typeof updateProfile
>;
const createContributionSubmissionMock =
  createContributionSubmission as jest.MockedFunction<
    typeof createContributionSubmission
  >;
const getUserSettingsMock = getUserSettings as jest.MockedFunction<
  typeof getUserSettings
>;
const updateUserSettingsMock = updateUserSettings as jest.MockedFunction<
  typeof updateUserSettings
>;
const createUserMock = createUser as jest.MockedFunction<typeof createUser>;
const createTopicMock = createTopic as jest.MockedFunction<typeof createTopic>;
const updateTopicMock = updateTopic as jest.MockedFunction<typeof updateTopic>;
const createPostMock = createPost as jest.MockedFunction<typeof createPost>;
const updatePostMock = updatePost as jest.MockedFunction<typeof updatePost>;
const deleteTopicMock = deleteTopic as jest.MockedFunction<typeof deleteTopic>;
const deletePostMock = deletePost as jest.MockedFunction<typeof deletePost>;
const createTopicNoteMock = createTopicNote as jest.MockedFunction<
  typeof createTopicNote
>;

describe('API app', () => {
  beforeEach(() => {
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
  });

  it('blocks protected API routes until installation is complete', async () => {
    mockedIsInstalled.mockResolvedValue(false);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      installed: false,
      msg: 'Application not installed. Please complete setup at /install.'
    });
  });

  it('scopes post comment deletion to the post id from the route', async () => {
    prismaMock.postComment.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/posts/99/comments/5');

    expect(res.status).toBe(404);
    expect(prismaMock.postComment.findFirst).toHaveBeenCalledWith({
      where: { id: 5, postId: 99 }
    });
    expect(prismaMock.postComment.delete).not.toHaveBeenCalled();
  });

  it('creates a post for the authenticated user', async () => {
    prismaMock.post.create.mockResolvedValue({
      id: 14,
      userId: 7,
      title: 'Launch post',
      text: 'Some text',
      category: 'news',
      tags: ['launch'],
      user: { id: 7, username: 'kai', avatar: null },
      comments: []
    });

    const res = await request(app)
      .post('/api/posts')
      .send({
        title: 'Launch post',
        text: 'Some text',
        category: 'news',
        tags: ['launch']
      });

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        title: 'Launch post',
        text: 'Some text',
        category: 'news',
        tags: ['launch']
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, username: true, avatar: true } }
          }
        }
      }
    });
    expect(res.body.title).toBe('Launch post');
  });

  it('creates a post comment for an existing post', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 14, userId: 7 });
    prismaMock.postComment.create.mockResolvedValue({
      id: 5,
      postId: 14,
      userId: 7,
      text: 'Nice post',
      user: { id: 7, username: 'kai', avatar: null }
    });

    const res = await request(app).post('/api/posts/14/comments').send({
      text: 'Nice post'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.postComment.create).toHaveBeenCalledWith({
      data: { postId: 14, userId: 7, text: 'Nice post' },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    expect(res.body.text).toBe('Nice post');
  });

  it('subscribes to a topic with a 204 response', async () => {
    const res = await request(app).post('/api/subscriptions/subscribe').send({
      topicId: 44,
      action: 'subscribe'
    });

    expect(res.status).toBe(204);
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith({
      where: { userId_topicId: { userId: 7, topicId: 44 } },
      create: { userId: 7, topicId: 44 },
      update: {}
    });
  });

  it('unsubscribes from comment notifications with a 204 response', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({
        page: 'communities',
        pageId: 3,
        action: 'unsubscribe'
      });

    expect(res.status).toBe(204);
    expect(prismaMock.commentSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, page: 'communities', pageId: 3 }
    });
  });

  it('rejects notification deletion for non-owners', async () => {
    prismaMock.notification.findUnique.mockResolvedValue({
      id: 8,
      userId: 99
    });

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.notification.delete).not.toHaveBeenCalled();
  });

  it('deletes a notification for the owner', async () => {
    prismaMock.notification.findUnique.mockResolvedValue({
      id: 8,
      userId: 7
    });

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.delete).toHaveBeenCalledWith({
      where: { id: 8 }
    });
  });

  it('rejects post deletion for non-owners', async () => {
    prismaMock.post.findUnique.mockResolvedValue({
      id: 14,
      userId: 99
    });

    const res = await request(app).delete('/api/posts/14');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.post.delete).not.toHaveBeenCalled();
  });

  it('deletes a post for the owner', async () => {
    prismaMock.post.findUnique.mockResolvedValue({
      id: 14,
      userId: 7
    });

    const res = await request(app).delete('/api/posts/14');

    expect(res.status).toBe(204);
    expect(prismaMock.post.delete).toHaveBeenCalledWith({
      where: { id: 14 }
    });
  });

  it('returns a msg response when registration hits an existing user', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 1 });

    const res = await request(app).post('/api/auth/register').send({
      username: 'existing-user',
      email: 'exists@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User already exists' });
  });

  it('returns a msg response when login is attempted on a disabled account', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      password: 'hashed-password',
      disabled: true
    });

    const res = await request(app).post('/api/auth').send({
      email: 'disabled@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Account disabled' });
  });

  it('logs in successfully and returns a user plus auth cookie', async () => {
    const authUser = {
      id: 7,
      username: 'kai',
      email: 'kai@example.com',
      avatar: null,
      isArtist: false,
      isDonor: false,
      canDownload: true,
      inviteCount: 0,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastLogin: '2026-04-24T00:00:00.000Z',
      userRank: {
        level: 100,
        name: 'User',
        color: '',
        badge: '',
        permissions: {}
      }
    };
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      password: 'hashed-password',
      disabled: false
    });
    bcryptMock.compare.mockResolvedValue(true);
    prismaMock.user.update.mockResolvedValue(authUser);

    const res = await request(app).post('/api/auth').send({
      email: 'kai@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: authUser });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=signed-jwt')])
    );
  });

  it('returns the current authenticated user from /api/auth', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'kai',
      email: 'kai@example.com',
      avatar: null,
      isArtist: false,
      isDonor: false,
      canDownload: true,
      inviteCount: 0,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastLogin: '2026-04-24T00:00:00.000Z',
      userRank: {
        level: 100,
        name: 'User',
        color: '',
        badge: '',
        permissions: {}
      }
    });

    const res = await request(app).get('/api/auth');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('kai');
  });

  it('returns 401 from /api/auth when the authenticated user no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/auth');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ msg: 'Unauthorized' });
  });

  it('clears the auth cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=;')])
    );
  });

  it('maps profile invite exhaustion to a msg response', async () => {
    createInviteMock.mockResolvedValue({ ok: false, reason: 'no_invites' });

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({
        email: 'friend@example.com',
        reason: 'trusted collaborator'
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'No invites remaining' });
  });

  it('returns the invite key on successful invite creation', async () => {
    createInviteMock.mockResolvedValue({
      ok: true,
      inviteKey: 'invite-key-123'
    });

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({
        email: 'friend@example.com',
        reason: 'trusted collaborator'
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ inviteKey: 'invite-key-123' });
  });

  it('returns the refreshed profile payload after updating /profile/me', async () => {
    updateProfileMock.mockResolvedValue({
      id: 7,
      username: 'kai',
      avatar: null,
      profile: {
        id: 3,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'New Title',
        profileInfo: null
      },
      userSettings: {
        id: 4,
        siteAppearance: 'dark',
        externalStylesheet: null,
        styledTooltips: true,
        paranoia: 0
      },
      userRank: { name: 'User', color: '' },
      inviteTree: []
    } as Awaited<ReturnType<typeof updateProfile>>);

    const res = await request(app).put('/api/profile/me').send({
      profileTitle: 'New Title',
      siteAppearance: 'dark'
    });

    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(7, {
      profileTitle: 'New Title',
      siteAppearance: 'dark'
    });
    expect(res.body.profile.profileTitle).toBe('New Title');
  });

  it('disables the current account and clears the auth cookie', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 7, disabled: true });

    const res = await request(app).delete('/api/profile');

    expect(res.status).toBe(204);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { disabled: true }
    });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=;')])
    );
  });

  it('returns user settings for the authenticated user', async () => {
    getUserSettingsMock.mockResolvedValue({
      id: 4,
      siteAppearance: 'dark',
      externalStylesheet: null,
      styledTooltips: true,
      paranoia: 1
    });

    const res = await request(app).get('/api/users/settings');

    expect(res.status).toBe(200);
    expect(getUserSettingsMock).toHaveBeenCalledWith(7);
    expect(res.body.siteAppearance).toBe('dark');
  });

  it('returns the updated settings payload from /api/users/settings', async () => {
    updateUserSettingsMock.mockResolvedValue({
      id: 4,
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png'
    });

    const res = await request(app).put('/api/users/settings').send({
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png'
    });

    expect(res.status).toBe(200);
    expect(updateUserSettingsMock).toHaveBeenCalledWith(7, {
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png'
    });
    expect(res.body.avatar).toBe('https://example.com/avatar.png');
  });

  it('rejects admin user creation without users_edit permission', async () => {
    const res = await request(app).post('/api/users').send({
      username: 'new-user',
      email: 'new@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Permission denied' });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('returns a msg response when admin user creation hits an existing user', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { users_edit: true }
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: 99 });

    const res = await request(app).post('/api/users').send({
      username: 'existing-user',
      email: 'exists@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User already exists' });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('creates a user for admins with users_edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { users_edit: true }
    });
    prismaMock.user.findFirst.mockResolvedValue(null);
    createUserMock.mockResolvedValue({
      id: 18,
      username: 'new-user',
      email: 'new@example.com'
    });

    const res = await request(app).post('/api/users').send({
      username: 'new-user',
      email: 'new@example.com',
      password: 'password123',
      userRankId: 2
    });

    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledWith(
      {
        username: 'new-user',
        email: 'new@example.com',
        password: 'password123',
        userRankId: 2
      },
      7
    );
    expect(res.body).toEqual({
      id: 18,
      username: 'new-user',
      email: 'new@example.com'
    });
  });

  it('returns ValidationError for malformed comment targets', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'hello'
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('creates a comment for a valid comment target', async () => {
    prismaMock.comment.create.mockResolvedValue({
      id: 12,
      page: 'communities',
      body: 'hello',
      communityId: 3,
      authorId: 7,
      author: { id: 7, username: 'kai', avatar: null }
    });

    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'hello',
      communityId: 3
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith({
      data: {
        page: 'communities',
        body: 'hello',
        authorId: 7,
        communityId: 3
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } }
      }
    });
    expect(res.body.communityId).toBe(3);
  });

  it('updates a comment for the owner', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 7,
      body: 'old body'
    });
    prismaMock.comment.update.mockResolvedValue({
      id: 12,
      authorId: 7,
      body: 'new body',
      editedUserId: 7
    });

    const res = await request(app).put('/api/comments/12').send({
      body: 'new body'
    });

    expect(res.status).toBe(200);
    expect(prismaMock.comment.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({
        body: 'new body',
        editedUserId: 7
      })
    });
    expect(res.body.body).toBe('new body');
  });

  it('maps missing contribution community to a msg response', async () => {
    createContributionSubmissionMock.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 99,
        type: 'Music',
        title: 'Test Release',
        year: 2024,
        fileType: 'wav',
        sizeInBytes: 12345,
        collaborators: [{ artist: 'Test Artist', importance: 'primary' }]
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Community not found' });
  });

  it('returns the created contribution payload on successful submission', async () => {
    createContributionSubmissionMock.mockResolvedValue({
      id: 12,
      user: { id: 7, username: 'kai' },
      release: { id: 55, title: 'Test Release', communityId: 3 },
      collaborators: [{ id: 21, name: 'Test Artist' }],
      releaseDescription: 'A real contribution'
    } as Awaited<ReturnType<typeof createContributionSubmission>>);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 3,
        type: 'Music',
        title: 'Test Release',
        year: 2024,
        fileType: 'wav',
        sizeInBytes: 12345,
        releaseDescription: 'A real contribution',
        collaborators: [{ artist: 'Test Artist', importance: 'primary' }]
      });

    expect(res.status).toBe(201);
    expect(createContributionSubmissionMock).toHaveBeenCalledWith({
      userId: 7,
      input: expect.objectContaining({
        communityId: 3,
        title: 'Test Release',
        type: 'Music'
      })
    });
    expect(res.body.release.title).toBe('Test Release');
  });

  it('creates a forum topic when the user meets the create-class requirement', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({
      id: 9,
      minClassCreate: 100
    });
    createTopicMock.mockResolvedValue({
      id: 44,
      title: 'New Topic',
      forumId: 9,
      authorId: 7
    } as Awaited<ReturnType<typeof createTopic>>);

    const res = await request(app).post('/api/forums/9/topics').send({
      title: 'New Topic',
      body: 'Opening post body'
    });

    expect(res.status).toBe(201);
    expect(createTopicMock).toHaveBeenCalledWith(9, 7, {
      title: 'New Topic',
      body: 'Opening post body',
      question: undefined,
      answers: undefined
    });
    expect(res.body.title).toBe('New Topic');
  });

  it('updates a forum topic for the owner', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 7,
      deletedAt: null
    });
    updateTopicMock.mockResolvedValue({
      id: 44,
      title: 'Renamed Topic',
      isLocked: false,
      isSticky: false
    } as Awaited<ReturnType<typeof updateTopic>>);

    const res = await request(app).put('/api/forums/9/topics/44').send({
      title: 'Renamed Topic'
    });

    expect(res.status).toBe(200);
    expect(updateTopicMock).toHaveBeenCalledWith(44, {
      title: 'Renamed Topic',
      isLocked: undefined,
      isSticky: undefined
    });
    expect(res.body.title).toBe('Renamed Topic');
  });

  it('creates a forum post when the topic is unlocked and belongs to the forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9, minClassRead: 0 });
    prismaMock.forumTopic.findUnique.mockResolvedValue({
      id: 44,
      forumId: 9,
      isLocked: false
    });
    createPostMock.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'Reply body'
    } as Awaited<ReturnType<typeof createPost>>);

    const res = await request(app).post('/api/forums/9/topics/44/posts').send({
      body: 'Reply body'
    });

    expect(res.status).toBe(201);
    expect(createPostMock).toHaveBeenCalledWith(9, 44, 7, 'Reply body');
    expect(res.body.body).toBe('Reply body');
  });

  it('updates a forum post for the owner', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'Old body',
      deletedAt: null
    });
    updatePostMock.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'New body'
    } as Awaited<ReturnType<typeof updatePost>>);

    const res = await request(app)
      .put('/api/forums/9/topics/44/posts/21')
      .send({
        body: 'New body'
      });

    expect(res.status).toBe(200);
    expect(updatePostMock).toHaveBeenCalledWith(21, 7, 'Old body', 'New body');
    expect(res.body.body).toBe('New body');
  });

  it('rejects topic deletion for non-owners without moderator permissions', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 99,
      deletedAt: null
    });

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(deleteTopicMock).not.toHaveBeenCalled();
  });

  it('allows moderators to delete a forum post', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 99,
      deletedAt: null
    });
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { forums_moderate: true }
    });

    const res = await request(app).delete('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(204);
    expect(deletePostMock).toHaveBeenCalledWith(21, 44, 9, 7, true);
  });

  it('rejects comment deletion for non-owners without moderator permissions', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 99
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
  });

  it('allows owners to delete their own comments', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 7
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('allows moderators to delete comments they do not own', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 99
    });
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { forums_moderate: true }
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('rejects topic-note creation for non-moderators', async () => {
    const res = await request(app).post('/api/forums/topic-notes').send({
      forumTopicId: 44,
      body: 'staff note'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(createTopicNoteMock).not.toHaveBeenCalled();
  });

  it('allows moderators to create topic notes', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { forums_moderate: true }
    });
    createTopicNoteMock.mockResolvedValue({
      id: 77,
      forumTopicId: 44,
      authorId: 7,
      body: 'staff note'
    } as Awaited<ReturnType<typeof createTopicNote>>);

    const res = await request(app).post('/api/forums/topic-notes').send({
      forumTopicId: 44,
      body: 'staff note'
    });

    expect(res.status).toBe(201);
    expect(createTopicNoteMock).toHaveBeenCalledWith(44, 7, 'staff note');
    expect(res.body.body).toBe('staff note');
  });

  it('allows topic-note authors to delete their own note', async () => {
    prismaMock.forumTopicNote.findUnique.mockResolvedValue({
      id: 77,
      authorId: 7
    });

    const res = await request(app).delete('/api/forums/topic-notes/77');

    expect(res.status).toBe(204);
    expect(prismaMock.forumTopicNote.delete).toHaveBeenCalledWith({
      where: { id: 77 }
    });
  });

  it('filters forum listings by the current user rank', async () => {
    currentUserRankLevel = 100;
    prismaMock.forum.findMany.mockResolvedValue([
      { id: 1, name: 'Open Forum', minClassRead: 0 }
    ]);

    const res = await request(app).get('/api/forums');

    expect(res.status).toBe(200);
    expect(prismaMock.forum.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { minClassRead: { lte: 100 } }
      })
    );
    expect(res.body).toEqual([{ id: 1, name: 'Open Forum', minClassRead: 0 }]);
  });

  it('rejects direct forum access when the user rank is below minClassRead', async () => {
    currentUserRankLevel = 100;
    prismaMock.forum.findUnique.mockResolvedValue({
      id: 9,
      name: 'Staff Forum',
      minClassRead: 500
    });

    const res = await request(app).get('/api/forums/9');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      msg: 'Insufficient class to read this forum'
    });
  });
});
