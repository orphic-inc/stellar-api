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
      findFirst: jest.fn()
    },
    forumPost: {
      findFirst: jest.fn()
    },
    forumTopicNote: {
      findUnique: jest.fn(),
      delete: jest.fn()
    },
    postComment: {
      findFirst: jest.fn(),
      delete: jest.fn()
    },
    comment: {
      create: jest.fn(),
      findUnique: jest.fn()
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
import { deleteTopic, deletePost, createTopicNote } from './modules/forum';

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
  };
  forumPost: {
    findFirst: jest.Mock;
  };
  forumTopicNote: {
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
  postComment: {
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
  comment: {
    create: jest.Mock;
    findUnique: jest.Mock;
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

  it('returns ValidationError for malformed comment targets', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'hello'
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
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
