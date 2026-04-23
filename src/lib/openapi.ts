import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { profileUpdateSchema, inviteSchema } from '../schemas/profile';
import { adminCreateUserSchema, userSettingsSchema } from '../schemas/user';

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
      description: 'Validation error or already exists',
      content: { 'application/json': { schema: ValidationError } }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Logged out',
      content: { 'application/json': { schema: MsgResponse } }
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
      description: 'Validation error or duplicate user',
      content: { 'application/json': { schema: ValidationError } }
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
            msg: z.string(),
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

registry.registerPath({
  method: 'get',
  path: '/announcements',
  tags: ['Announcements'],
  responses: {
    200: {
      description: 'News and blog posts',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('success'),
            data: z.object({
              announcements: z.array(Announcement),
              blogPosts: z.array(
                z.object({
                  id: z.number(),
                  title: z.string(),
                  createdAt: z.string()
                })
              )
            })
          })
        }
      }
    }
  }
});

// ─── Forums ───────────────────────────────────────────────────────────────────

const Forum = registry.register(
  'Forum',
  z.object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    numTopics: z.number(),
    numPosts: z.number()
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
    createdAt: z.string()
  })
);

const ForumPost = registry.register(
  'ForumPost',
  z.object({
    id: z.number(),
    forumTopicId: z.number(),
    authorId: z.number(),
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const PaginatedForumTopics = registry.register(
  'PaginatedForumTopics',
  z.object({
    data: z.array(ForumTopic),
    total: z.number(),
    page: z.number(),
    limit: z.number()
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
        'application/json': {
          schema: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              forums: z.array(Forum)
            })
          )
        }
      }
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
  method: 'post',
  path: '/forums/{forumId}/topics',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().min(1),
            body: z.string().min(1),
            question: z.string().optional(),
            answers: z.string().optional()
          })
        }
      }
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
            total: z.number(),
            page: z.number(),
            limit: z.number()
          })
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/forums/{forumId}/topics/{topicId}/posts',
  tags: ['Forums'],
  request: {
    params: z.object({ forumId: z.string(), topicId: z.string() }),
    body: {
      content: {
        'application/json': { schema: z.object({ body: z.string().min(1) }) }
      }
    }
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
            total: z.number(),
            page: z.number(),
            limit: z.number()
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
            total: z.number(),
            page: z.number(),
            limit: z.number()
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
    createdAt: z.string()
  })
);

registry.registerPath({
  method: 'get',
  path: '/comments',
  tags: ['Comments'],
  request: {
    query: z.object({
      page: z.string().optional(),
      pageId: z.string().optional()
    })
  },
  responses: {
    200: {
      description: 'Comments',
      content: { 'application/json': { schema: z.array(Comment) } }
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
        'application/json': {
          schema: z.object({
            page: z.string(),
            body: z.string().min(1),
            communityId: z.number().optional(),
            contributionId: z.number().optional(),
            artistId: z.number().optional()
          })
        }
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
  method: 'delete',
  path: '/comments/{id}',
  tags: ['Comments'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Comment deleted',
      content: { 'application/json': { schema: MsgResponse } }
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
    vanityHouse: z.boolean()
  })
);

registry.registerPath({
  method: 'get',
  path: '/artists',
  tags: ['Artists'],
  responses: {
    200: {
      description: 'All artists',
      content: { 'application/json': { schema: z.array(Artist) } }
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
