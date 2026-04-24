import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { profileUpdateSchema, inviteSchema } from '../schemas/profile';
import { adminCreateUserSchema, userSettingsSchema } from '../schemas/user';
import { createContributionSchema } from '../schemas/contribution';
import {
  createForumSchema,
  updateForumSchema,
  createTopicSchema,
  updateTopicSchema,
  createPostSchema,
  updatePostSchema,
  lastReadSchema
} from '../schemas/forum';
import {
  createForumCategorySchema,
  updateForumCategorySchema
} from '../schemas/forumCategory';
import { pollSchema, pollVoteSchema } from '../schemas/poll';
import {
  artistSchema,
  similarArtistSchema,
  artistAliasSchema,
  artistTagSchema
} from '../schemas/artist';
import { stylesheetSchema } from '../schemas/stylesheet';
import {
  subscribeSchema,
  subscribeCommentsSchema
} from '../schemas/subscription';
import { announcementSchema } from '../schemas/announcement';
import {
  commentQuerySchema,
  createCommentSchema,
  updateCommentSchema
} from '../schemas/comment';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Shared response schemas ──────────────────────────────────────────────────

const MsgResponse = registry.register(
  'MsgResponse',
  z.object({ msg: z.string() })
);

registry.register('ErrorResponse', z.object({ error: z.string() }));

const ValidationError = registry.register(
  'ValidationError',
  z.object({ errors: z.record(z.string(), z.array(z.string())) })
);

const PaginationMeta = registry.register(
  'PaginationMeta',
  z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number()
  })
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

const LoginBody = registry.register(
  'LoginBody',
  z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
);

const RegisterBody = registry.register(
  'RegisterBody',
  z.object({
    username: z.string().min(1).max(32),
    email: z.string().email(),
    password: z.string().min(6),
    inviteKey: z.string().optional()
  })
);

const AuthUser = registry.register(
  'AuthUser',
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email().optional(),
    avatar: z.string().nullable(),
    inviteCount: z.number().optional(),
    dateRegistered: z.string().optional(),
    lastLogin: z.string().nullable().optional(),
    isArtist: z.boolean().optional(),
    isDonor: z.boolean().optional(),
    canDownload: z.boolean().optional(),
    userRank: z.object({
      level: z.number(),
      name: z.string(),
      color: z.string(),
      badge: z.string().optional(),
      permissions: z.record(z.string(), z.boolean()).optional()
    })
  })
);

registry.registerPath({
  method: 'post',
  path: '/auth',
  tags: ['Auth'],
  request: { body: { content: { 'application/json': { schema: LoginBody } } } },
  responses: {
    200: {
      description: 'JWT issued, user returned',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: MsgResponse } }
    },
    403: {
      description: 'Account disabled',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['Auth'],
  request: {
    body: { content: { 'application/json': { schema: RegisterBody } } }
  },
  responses: {
    200: {
      description: 'Registered and logged in',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: {
      description: 'User already exists',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  responses: {
    204: {
      description: 'Logged out'
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/auth',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: AuthUser } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Install ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/install',
  tags: ['Install'],
  responses: {
    200: {
      description: 'Install status',
      content: {
        'application/json': { schema: z.object({ installed: z.boolean() }) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/install',
  tags: ['Install'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            username: z.string().min(1).max(30),
            email: z.string().email(),
            password: z.string().min(8)
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Installation complete',
      content: {
        'application/json': {
          schema: z.object({ user: AuthUser })
        }
      }
    },
    400: {
      description: 'Already installed or validation error',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

const PublicUser = registry.register(
  'PublicUser',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    dateRegistered: z.string(),
    isArtist: z.boolean(),
    isDonor: z.boolean(),
    userRank: z.object({ name: z.string(), color: z.string() }),
    profile: z.object({
      id: z.number(),
      avatar: z.string().nullable().optional(),
      avatarMouseoverText: z.string().nullable().optional(),
      profileTitle: z.string().nullable().optional(),
      profileInfo: z.string().nullable().optional()
    })
  })
);

const ProfileDetails = registry.register(
  'ProfileDetails',
  z.object({
    id: z.number(),
    avatar: z.string().nullable().optional(),
    avatarMouseoverText: z.string().nullable().optional(),
    profileTitle: z.string().nullable().optional(),
    profileInfo: z.string().nullable().optional()
  })
);

const UserRankSummary = registry.register(
  'UserRankSummary',
  z.object({
    name: z.string(),
    color: z.string(),
    badge: z.string().optional()
  })
);

const UserSettings = registry.register(
  'UserSettings',
  z.object({
    id: z.number(),
    siteAppearance: z.string(),
    externalStylesheet: z.string().nullable().optional(),
    styledTooltips: z.boolean(),
    paranoia: z.number()
  })
);

const InviteNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email(),
    joinedAt: z.string(),
    lastSeen: z.string().nullable().optional(),
    uploaded: z.string().optional(),
    downloaded: z.string().optional(),
    ratio: z.string().optional(),
    children: z.array(InviteNodeSchema).optional()
  })
);

const InviteNode = registry.register('InviteNode', InviteNodeSchema);

const PublicProfile = registry.register(
  'PublicProfile',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    dateRegistered: z.string(),
    isArtist: z.boolean(),
    isDonor: z.boolean(),
    userRank: UserRankSummary,
    profile: ProfileDetails,
    userSettings: z.object({
      siteAppearance: z.string().optional(),
      styledTooltips: z.boolean().optional()
    })
  })
);

const MyProfile = registry.register(
  'MyProfile',
  z.object({
    id: z.number(),
    username: z.string(),
    avatar: z.string().nullable(),
    profile: ProfileDetails,
    userSettings: UserSettings,
    userRank: z.object({
      name: z.string(),
      color: z.string()
    }),
    inviteTree: z.array(InviteNode)
  })
);

const AdminCreatedUser = registry.register(
  'AdminCreatedUser',
  z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().email()
  })
);

registry.registerPath({
  method: 'get',
  path: '/users/{id}',
  tags: ['Users'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'User profile',
      content: { 'application/json': { schema: PublicUser } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/users/settings',
  tags: ['Users'],
  responses: {
    200: {
      description: 'Current user settings',
      content: { 'application/json': { schema: UserSettings } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/users/settings',
  tags: ['Users'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: userSettingsSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated current user settings',
      content: {
        'application/json': {
          schema: UserSettings.extend({
            avatar: z.string().optional()
          })
        }
      }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/users',
  tags: ['Users'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: adminCreateUserSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created user',
      content: {
        'application/json': {
          schema: AdminCreatedUser
        }
      }
    },
    400: {
      description: 'User already exists',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Profile ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/profile/me',
  tags: ['Profile'],
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: MyProfile } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Profile not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/profile/user/{userId}',
  tags: ['Profile'],
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: {
      description: 'Public profile',
      content: { 'application/json': { schema: PublicProfile } }
    },
    404: {
      description: 'Profile not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/profile/me',
  tags: ['Profile'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: profileUpdateSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated current user profile',
      content: { 'application/json': { schema: MyProfile } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Profile not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/profile',
  tags: ['Profile'],
  responses: {
    204: {
      description: 'Account disabled'
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/profile/referral/create-invite',
  tags: ['Profile'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: inviteSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Invite created',
      content: {
        'application/json': {
          schema: z.object({
            inviteKey: z.string()
          })
        }
      }
    },
    403: {
      description: 'No invites remaining',
      content: { 'application/json': { schema: MsgResponse } }
    },
    409: {
      description: 'Invite already exists',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Home ─────────────────────────────────────────────────────────────────────

const HomepageFeaturedRelease = registry.register(
  'HomepageFeaturedRelease',
  z.object({
    id: z.number(),
    title: z.string(),
    year: z.number().nullable().optional(),
    image: z.string().nullable().optional(),
    communityId: z.number(),
    artist: z
      .object({
        id: z.number(),
        name: z.string()
      })
      .nullable()
      .optional()
  })
);

const HomepageFeaturedAlbum = registry.register(
  'HomepageFeaturedAlbum',
  z.object({
    id: z.number(),
    title: z.string(),
    started: z.string(),
    ended: z.string(),
    threadId: z.number().nullable().optional(),
    release: HomepageFeaturedRelease
  })
);

registry.registerPath({
  method: 'get',
  path: '/home/featured',
  tags: ['Home'],
  responses: {
    200: {
      description: 'Homepage featured content',
      content: {
        'application/json': {
          schema: z.object({
            albumOfTheMonth: HomepageFeaturedAlbum.nullable(),
            vanityHouse: HomepageFeaturedRelease.nullable()
          })
        }
      }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Announcements ────────────────────────────────────────────────────────────

const Announcement = registry.register(
  'Announcement',
  z.object({
    id: z.number(),
    title: z.string(),
    body: z.string(),
    createdAt: z.string()
  })
);

const BlogPost = registry.register(
  'BlogPost',
  z.object({
    id: z.number(),
    title: z.string(),
    body: z.string().optional(),
    createdAt: z.string(),
    user: z
      .object({
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional()
  })
);

const AnnouncementsResponse = registry.register(
  'AnnouncementsResponse',
  z.object({
    announcements: z.array(Announcement),
    blogPosts: z.array(BlogPost)
  })
);

const SiteStats = registry.register(
  'SiteStats',
  z.object({
    totalUsers: z.number(),
    enabledUsers: z.number(),
    activeToday: z.number(),
    activeThisWeek: z.number(),
    activeThisMonth: z.number(),
    communities: z.number(),
    releases: z.number(),
    artists: z.number(),
    blogPosts: z.number(),
    announcements: z.number(),
    comments: z.number(),
    contributedLinks: z.number(),
    contributedLinkDownloads: z.number()
  })
);

const Notification = registry.register(
  'Notification',
  z.object({
    id: z.number(),
    page: z.string(),
    pageId: z.number(),
    postId: z.number(),
    createdAt: z.string(),
    quoter: z.object({
      id: z.number(),
      username: z.string(),
      avatar: z.string().nullable().optional()
    })
  })
);

const Subscription = registry.register(
  'Subscription',
  z.object({
    id: z.number(),
    topicId: z.number()
  })
);

const Stylesheet = registry.register(
  'Stylesheet',
  z.object({
    id: z.number(),
    name: z.string(),
    cssUrl: z.string(),
    createdAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/announcements',
  tags: ['Announcements'],
  responses: {
    200: {
      description: 'News and blog posts',
      content: {
        'application/json': { schema: AnnouncementsResponse }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements',
  tags: ['Announcements'],
  request: {
    body: {
      content: { 'application/json': { schema: announcementSchema } }
    }
  },
  responses: {
    201: {
      description: 'Announcement created',
      content: { 'application/json': { schema: Announcement } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/{id}',
  tags: ['Announcements'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Announcement deleted'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/announcements/blog',
  tags: ['Announcements'],
  request: {
    body: {
      content: { 'application/json': { schema: announcementSchema } }
    }
  },
  responses: {
    201: {
      description: 'Blog post created',
      content: { 'application/json': { schema: BlogPost } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/announcements/blog/{id}',
  tags: ['Announcements'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Blog post deleted'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stats',
  tags: ['Stats'],
  responses: {
    200: {
      description: 'Site statistics',
      content: { 'application/json': { schema: SiteStats } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet',
  tags: ['Stylesheets'],
  responses: {
    200: {
      description: 'Available stylesheets',
      content: {
        'application/json': { schema: z.array(Stylesheet) }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Stylesheet',
      content: { 'application/json': { schema: Stylesheet } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/stylesheet',
  tags: ['Stylesheets'],
  request: {
    body: { content: { 'application/json': { schema: stylesheetSchema } } }
  },
  responses: {
    201: {
      description: 'Stylesheet created',
      content: { 'application/json': { schema: Stylesheet } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/stylesheet/{id}',
  tags: ['Stylesheets'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Stylesheet removed'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/notifications',
  tags: ['Notifications'],
  responses: {
    200: {
      description: 'Notifications',
      content: {
        'application/json': { schema: z.array(Notification) }
      }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/notifications/{id}',
  tags: ['Notifications'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Notification removed'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/subscriptions',
  tags: ['Subscriptions'],
  responses: {
    200: {
      description: 'Forum subscriptions',
      content: {
        'application/json': { schema: z.array(Subscription) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/subscriptions/subscribe',
  tags: ['Subscriptions'],
  request: {
    body: { content: { 'application/json': { schema: subscribeSchema } } }
  },
  responses: {
    204: {
      description: 'Subscription updated'
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/subscriptions/subscribe-comments',
  tags: ['Subscriptions'],
  request: {
    body: {
      content: { 'application/json': { schema: subscribeCommentsSchema } }
    }
  },
  responses: {
    204: {
      description: 'Comment subscription updated'
    }
  }
});

// ─── Forums ───────────────────────────────────────────────────────────────────

const Forum = registry.register(
  'Forum',
  z.object({
    id: z.number(),
    sort: z.number(),
    name: z.string(),
    description: z.string(),
    minClassRead: z.number().optional(),
    minClassWrite: z.number().optional(),
    minClassCreate: z.number().optional(),
    numTopics: z.number(),
    numPosts: z.number(),
    forumCategory: z
      .object({
        id: z.number(),
        name: z.string()
      })
      .optional(),
    lastTopic: z
      .object({
        id: z.number(),
        title: z.string()
      })
      .optional()
  })
);

const ForumCategory = registry.register(
  'ForumCategory',
  z.object({
    id: z.number(),
    name: z.string(),
    sort: z.number(),
    forums: z.array(Forum).optional()
  })
);

const ForumTopic = registry.register(
  'ForumTopic',
  z.object({
    id: z.number(),
    title: z.string(),
    forumId: z.number(),
    authorId: z.number(),
    isLocked: z.boolean(),
    isSticky: z.boolean(),
    numPosts: z.number(),
    author: z
      .object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional(),
    lastPost: z
      .object({
        id: z.number(),
        createdAt: z.string(),
        author: z
          .object({
            id: z.number(),
            username: z.string()
          })
          .optional()
      })
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const ForumPost = registry.register(
  'ForumPost',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    authorId: z.number(),
    body: z.string(),
    author: z
      .object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const ForumPollVote = registry.register(
  'ForumPollVote',
  z.object({
    id: z.number(),
    userId: z.number(),
    vote: z.number()
  })
);

const ForumPoll = registry.register(
  'ForumPoll',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    question: z.string(),
    answers: z.string(),
    featured: z.string().nullable().optional(),
    closed: z.boolean(),
    votes: z.array(ForumPollVote)
  })
);

const ForumLastReadTopic = registry.register(
  'ForumLastReadTopic',
  z.object({
    id: z.number(),
    userId: z.number(),
    forumTopicId: z.number(),
    forumPostId: z.number()
  })
);

const PaginatedForumTopics = registry.register(
  'PaginatedForumTopics',
  z.object({
    data: z.array(ForumTopic),
    meta: PaginationMeta
  })
);

registry.registerPath({
  method: 'get',
  path: '/forums/categories',
  tags: ['Forums'],
  responses: {
    200: {
      description: 'All categories with forums',
      content: {
        'application/json': { schema: z.array(ForumCategory) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/categories',
  tags: ['Forums'],
  request: {
    body: {
      content: { 'application/json': { schema: createForumCategorySchema } }
    }
  },
  responses: {
    201: {
      description: 'Category created',
      content: { 'application/json': { schema: ForumCategory } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/categories/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateForumCategorySchema } }
    }
  },
  responses: {
    200: {
      description: 'Category updated',
      content: { 'application/json': { schema: ForumCategory } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/categories/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Category deleted' },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums',
  tags: ['Forums'],
  responses: {
    200: {
      description: 'Forums',
      content: { 'application/json': { schema: z.array(Forum) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Forum',
      content: { 'application/json': { schema: Forum } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: createForumSchema } } }
  },
  responses: {
    201: {
      description: 'Forum created',
      content: { 'application/json': { schema: Forum } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateForumSchema } } }
  },
  responses: {
    200: {
      description: 'Forum updated',
      content: { 'application/json': { schema: Forum } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Forum deleted' },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string() }),
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description: 'Paginated topics',
      content: { 'application/json': { schema: PaginatedForumTopics } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() })
  },
  responses: {
    200: {
      description: 'Topic',
      content: { 'application/json': { schema: ForumTopic } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string() }),
    body: {
      content: { 'application/json': { schema: createTopicSchema } }
    }
  },
  responses: {
    201: {
      description: 'Topic created',
      content: { 'application/json': { schema: ForumTopic } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    body: { content: { 'application/json': { schema: updateTopicSchema } } }
  },
  responses: {
    200: {
      description: 'Topic updated',
      content: { 'application/json': { schema: ForumTopic } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{forumId}/topics/{topicId}',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() })
  },
  responses: {
    204: {
      description: 'Topic removed'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/posts',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    query: z.object({ page: z.string().optional() })
  },
  responses: {
    200: {
      description: 'Paginated posts',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ForumPost),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    })
  },
  responses: {
    200: {
      description: 'Post',
      content: { 'application/json': { schema: ForumPost } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics/{topicId}/posts',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    body: { content: { 'application/json': { schema: createPostSchema } } }
  },
  responses: {
    201: {
      description: 'Post created',
      content: { 'application/json': { schema: ForumPost } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    },
    403: {
      description: 'Topic locked',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    }),
    body: { content: { 'application/json': { schema: updatePostSchema } } }
  },
  responses: {
    200: {
      description: 'Post updated',
      content: { 'application/json': { schema: ForumPost } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/{forumId}/topics/{topicId}/posts/{id}',
  tags: ['Forums'],
  request: {
    params: z.object({
      forumId: z.string(),
      topicId: z.string(),
      id: z.string()
    })
  },
  responses: {
    204: {
      description: 'Post removed'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/polls/{topicId}',
  tags: ['Forums'],
  request: { params: z.object({ topicId: z.string() }) },
  responses: {
    200: {
      description: 'Poll',
      content: { 'application/json': { schema: ForumPoll } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/polls',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: pollSchema } } }
  },
  responses: {
    201: {
      description: 'Poll created',
      content: { 'application/json': { schema: ForumPoll } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/forums/polls/{id}/close',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Poll closed',
      content: { 'application/json': { schema: ForumPoll } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/poll-votes',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: pollVoteSchema } } }
  },
  responses: {
    200: {
      description: 'Vote recorded',
      content: { 'application/json': { schema: ForumPollVote } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/forums/last-read',
  tags: ['Forums'],
  responses: {
    200: {
      description: 'Last-read markers',
      content: {
        'application/json': { schema: z.array(ForumLastReadTopic) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/last-read',
  tags: ['Forums'],
  request: {
    body: { content: { 'application/json': { schema: lastReadSchema } } }
  },
  responses: {
    200: {
      description: 'Last-read marker saved',
      content: { 'application/json': { schema: ForumLastReadTopic } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

// ─── Communities ──────────────────────────────────────────────────────────────

const CommunityStaffMember = registry.register(
  'CommunityStaffMember',
  z.object({
    id: z.number(),
    username: z.string()
  })
);

const Community = registry.register(
  'Community',
  z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    registrationStatus: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    staff: z.array(CommunityStaffMember).optional(),
    _count: z
      .object({
        releases: z.number(),
        contributors: z.number(),
        consumers: z.number()
      })
      .optional()
  })
);

const ReleaseTag = registry.register(
  'ReleaseTag',
  z.object({
    id: z.number(),
    name: z.string()
  })
);

const ReleaseArtist = registry.register(
  'ReleaseArtist',
  z.object({
    id: z.number(),
    name: z.string()
  })
);

const ReleaseContribution = registry.register(
  'ReleaseContribution',
  z.object({
    id: z.number(),
    user: z.object({
      id: z.number(),
      username: z.string()
    }),
    collaborators: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        vanityHouse: z.boolean().optional()
      })
    ),
    releaseDescription: z.string().nullable().optional()
  })
);

const Contribution = registry.register(
  'Contribution',
  z.object({
    id: z.number(),
    user: z.object({
      id: z.number(),
      username: z.string()
    }),
    release: z.object({
      id: z.number(),
      title: z.string(),
      communityId: z.number().nullable().optional()
    }),
    collaborators: z.array(
      z.object({
        id: z.number(),
        name: z.string()
      })
    ),
    releaseDescription: z.string().nullable().optional(),
    createdAt: z.string().optional()
  })
);

const Release = registry.register(
  'Release',
  z.object({
    id: z.number(),
    title: z.string(),
    communityId: z.number().nullable(),
    year: z.number().nullable().optional(),
    type: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    artist: ReleaseArtist.optional(),
    tags: z.array(ReleaseTag).optional(),
    contributions: z.array(ReleaseContribution).optional()
  })
);

const UserRank = registry.register(
  'UserRank',
  z.object({
    id: z.number(),
    name: z.string(),
    level: z.number(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    color: z.string().optional(),
    badge: z.string().optional(),
    userCount: z.number().optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/communities',
  tags: ['Communities'],
  responses: {
    200: {
      description: 'Paginated communities',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Community),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{id}',
  tags: ['Communities'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Community',
      content: { 'application/json': { schema: Community } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{id}/releases',
  tags: ['Communities'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Releases for community',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Release),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/communities/{communityId}/releases/{releaseId}',
  tags: ['Communities'],
  request: {
    params: z.object({
      communityId: z.string(),
      releaseId: z.string()
    })
  },
  responses: {
    200: {
      description: 'Release',
      content: { 'application/json': { schema: Release } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/contributions',
  tags: ['Contributions'],
  responses: {
    200: {
      description: 'Paginated contributions',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Contribution),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/contributions',
  tags: ['Contributions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createContributionSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Contribution submitted and release created',
      content: {
        'application/json': {
          schema: Contribution
        }
      }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    },
    404: {
      description: 'Community not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/user-ranks',
  tags: ['Tools'],
  responses: {
    200: {
      description: 'User ranks',
      content: { 'application/json': { schema: z.array(UserRank) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/tools/user-ranks/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'User rank',
      content: { 'application/json': { schema: UserRank } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Comments ─────────────────────────────────────────────────────────────────

const Comment = registry.register(
  'Comment',
  z.object({
    id: z.number(),
    page: z.string(),
    body: z.string(),
    authorId: z.number(),
    createdAt: z.string(),
    author: z
      .object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional()
  })
);

const PaginatedComments = registry.register(
  'PaginatedComments',
  z.object({
    data: z.array(Comment),
    meta: PaginationMeta
  })
);

registry.registerPath({
  method: 'delete',
  path: '/tools/user-ranks/{id}',
  tags: ['Tools'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'User rank deleted'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    },
    409: {
      description: 'Rank still assigned to users',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/comments',
  tags: ['Comments'],
  request: {
    query: commentQuerySchema
  },
  responses: {
    200: {
      description: 'Comments',
      content: { 'application/json': { schema: PaginatedComments } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/comments',
  tags: ['Comments'],
  request: {
    body: {
      content: {
        'application/json': { schema: createCommentSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Comment created',
      content: { 'application/json': { schema: Comment } }
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/comments/{id}',
  tags: ['Comments'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: updateCommentSchema } }
    }
  },
  responses: {
    200: {
      description: 'Comment updated',
      content: { 'application/json': { schema: Comment } }
    },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/comments/{id}',
  tags: ['Comments'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Comment deleted'
    },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Artists ──────────────────────────────────────────────────────────────────

const Artist = registry.register(
  'Artist',
  z.object({
    id: z.number(),
    name: z.string(),
    vanityHouse: z.boolean(),
    _count: z
      .object({
        releases: z.number()
      })
      .optional(),
    aliases: z
      .array(
        z.object({
          redirect: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    tags: z
      .array(
        z.object({
          tag: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    similarTo: z
      .array(
        z.object({
          similarArtist: z.object({
            id: z.number(),
            name: z.string()
          })
        })
      )
      .optional(),
    releases: z
      .array(
        z.object({
          id: z.number(),
          title: z.string(),
          year: z.number().nullable().optional()
        })
      )
      .optional()
  })
);

const ArtistHistory = registry.register(
  'ArtistHistory',
  z.object({
    id: z.number(),
    artistId: z.number(),
    editedAt: z.string(),
    description: z.string().nullable().optional(),
    editedUser: z
      .object({
        id: z.number(),
        username: z.string()
      })
      .optional()
  })
);

const SimilarArtist = registry.register(
  'SimilarArtist',
  z.object({
    similarArtist: z.object({
      id: z.number(),
      name: z.string()
    })
  })
);

registry.registerPath({
  method: 'get',
  path: '/artists',
  tags: ['Artists'],
  responses: {
    200: {
      description: 'Paginated artists',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Artist),
            meta: PaginationMeta
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistSchema } } }
  },
  responses: {
    201: {
      description: 'Artist created',
      content: { 'application/json': { schema: Artist } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Artist with releases and tags',
      content: { 'application/json': { schema: Artist } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'put',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: artistSchema } } }
  },
  responses: {
    200: {
      description: 'Artist updated',
      content: { 'application/json': { schema: Artist } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/artists/{id}',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: {
      description: 'Artist deleted'
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/history/{artistId}',
  tags: ['Artists'],
  request: { params: z.object({ artistId: z.string() }) },
  responses: {
    200: {
      description: 'Artist history',
      content: { 'application/json': { schema: z.array(ArtistHistory) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/revert/{historyId}',
  tags: ['Artists'],
  request: { params: z.object({ historyId: z.string() }) },
  responses: {
    200: {
      description: 'Artist reverted',
      content: {
        'application/json': {
          schema: z.object({
            msg: z.string(),
            artist: Artist
          })
        }
      }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/artists/{id}/similar',
  tags: ['Artists'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Similar artists',
      content: { 'application/json': { schema: z.array(SimilarArtist) } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/similar',
  tags: ['Artists'],
  request: {
    body: {
      content: { 'application/json': { schema: similarArtistSchema } }
    }
  },
  responses: {
    200: {
      description: 'Similar artist link created',
      content: {
        'application/json': { schema: z.record(z.string(), z.unknown()) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/alias',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistAliasSchema } } }
  },
  responses: {
    201: {
      description: 'Artist alias created',
      content: {
        'application/json': { schema: z.record(z.string(), z.unknown()) }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/artists/tag',
  tags: ['Artists'],
  request: {
    body: { content: { 'application/json': { schema: artistTagSchema } } }
  },
  responses: {
    200: {
      description: 'Artist tagged',
      content: {
        'application/json': { schema: z.record(z.string(), z.unknown()) }
      }
    }
  }
});

// ─── Posts ────────────────────────────────────────────────────────────────────

const PostComment = z.object({
  userId: z.number(),
  text: z.string(),
  date: z.string()
});

const Post = registry.register(
  'Post',
  z.object({
    id: z.number(),
    userId: z.number(),
    title: z.string(),
    text: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    comments: z.array(PostComment),
    createdAt: z.string(),
    user: z
      .object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable().optional()
      })
      .optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/posts',
  tags: ['Posts'],
  responses: {
    200: {
      description: 'All posts',
      content: { 'application/json': { schema: z.array(Post) } }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/posts/{id}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Post',
      content: { 'application/json': { schema: Post } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/posts',
  tags: ['Posts'],
  responses: {
    201: {
      description: 'Post created',
      content: { 'application/json': { schema: Post } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/posts/{id}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Post deleted' },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/posts/comment/{id}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    201: {
      description: 'Comment added; returns updated comments list',
      content: { 'application/json': { schema: z.array(PostComment) } }
    },
    404: {
      description: 'Post not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/posts/comment/{id}/{commentIdx}',
  tags: ['Posts'],
  request: { params: z.object({ id: z.string(), commentIdx: z.string() }) },
  responses: {
    204: { description: 'Comment deleted' },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Post or comment not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Forum topic notes ────────────────────────────────────────────────────────

const ForumTopicNote = registry.register(
  'ForumTopicNote',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    authorId: z.number(),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    author: z.object({ id: z.number(), username: z.string() }).optional()
  })
);

registry.registerPath({
  method: 'get',
  path: '/forums/topic-notes/{topicId}',
  tags: ['Forums'],
  request: { params: z.object({ topicId: z.string() }) },
  responses: {
    200: {
      description: 'Topic notes (moderators only)',
      content: { 'application/json': { schema: z.array(ForumTopicNote) } }
    },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/topic-notes',
  tags: ['Forums'],
  responses: {
    201: {
      description: 'Note created',
      content: { 'application/json': { schema: ForumTopicNote } }
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ValidationError } }
    },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

registry.registerPath({
  method: 'delete',
  path: '/forums/topic-notes/{id}',
  tags: ['Forums'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Note deleted' },
    403: {
      description: 'Not authorized',
      content: { 'application/json': { schema: MsgResponse } }
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: MsgResponse } }
    }
  }
});

// ─── Document builder ─────────────────────────────────────────────────────────

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Stellar API',
      version: '0.1.0',
      description:
        'REST API for the Stellar community tracker. All routes under `/api/*`. ' +
        'Authentication uses JWT cookies (`token` cookie set on login).'
    },
    servers: [{ url: '/api', description: 'API server' }]
  });
}
