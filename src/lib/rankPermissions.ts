export const PERMISSION_GROUPS = [
  {
    key: 'discovery',
    title: 'Discovery',
    permissions: [
      {
        key: 'advanced_search',
        label: 'Advanced search',
        description: 'Access advanced search and broader discovery tools.'
      },
      {
        key: 'users_search',
        label: 'Search users',
        description: 'Access elevated user search tooling.'
      }
    ]
  },
  {
    key: 'forums',
    title: 'Forums',
    permissions: [
      {
        key: 'forums_read',
        label: 'Read forums',
        description: 'Browse forum categories and topics.'
      },
      {
        key: 'forums_post',
        label: 'Post in forums',
        description: 'Create and reply to forum topics.'
      },
      {
        key: 'forums_moderate',
        label: 'Moderate forums',
        description: 'Edit, lock, move, and otherwise moderate forum content.'
      },
      {
        key: 'forums_manage',
        label: 'Manage forums',
        description: 'Manage forum categories, forums, and forum settings.'
      }
    ]
  },
  {
    key: 'communities',
    title: 'Communities',
    permissions: [
      {
        key: 'communities_manage',
        label: 'Manage communities',
        description: 'Create and manage communities and related metadata.'
      },
      {
        key: 'contributions_manage',
        label: 'Manage contributions',
        description:
          'Moderate releases, contributions, and related community content.'
      },
      {
        key: 'dnc_manage',
        label: 'Manage DNC',
        description: 'Manage the Do Not Contribute list.'
      }
    ]
  },
  {
    key: 'collages',
    title: 'Collages',
    permissions: [
      {
        key: 'collages_create',
        label: 'Create collages',
        description: 'Create new collages, including personal collages.'
      },
      {
        key: 'collages_manage',
        label: 'Manage collages',
        description: 'Edit owned collages and manage collage entries.'
      },
      {
        key: 'collages_moderate',
        label: 'Moderate collages',
        description: 'Recover, delete, and fully moderate collages.'
      }
    ]
  },
  {
    key: 'requests',
    title: 'Requests',
    permissions: [
      {
        key: 'requests_create',
        label: 'Create requests',
        description: 'Submit new requests.'
      },
      {
        key: 'requests_moderate',
        label: 'Moderate requests',
        description:
          'Edit, fill, unfill, and delete requests outside ownership.'
      }
    ]
  },
  {
    key: 'wiki',
    title: 'Wiki',
    permissions: [
      {
        key: 'wiki_edit',
        label: 'Edit wiki',
        description: 'Create and edit wiki pages.'
      },
      {
        key: 'wiki_manage',
        label: 'Manage wiki',
        description: 'Manage restricted wiki operations and revision tools.'
      }
    ]
  },
  {
    key: 'content',
    title: 'Content',
    permissions: [
      {
        key: 'news_manage',
        label: 'Manage news',
        description: 'Manage announcements, blog posts, and featured albums.'
      },
      {
        key: 'rules_manage',
        label: 'Manage rules',
        description: 'Manage rules pages.'
      },
      {
        key: 'tags_manage',
        label: 'Manage tags',
        description: 'Manage tag aliases and related tag tooling.'
      },
      {
        key: 'reports_manage',
        label: 'Manage reports',
        description: 'Work reports queues and report resolution flows.'
      },
      {
        key: 'staff_inbox_manage',
        label: 'Manage staff inbox',
        description: 'Work staff inbox queues, tickets, and canned responses.'
      }
    ]
  },
  {
    key: 'users',
    title: 'Users',
    permissions: [
      {
        key: 'users_edit',
        label: 'Edit users',
        description: 'Create users and manage user account state.'
      },
      {
        key: 'users_warn',
        label: 'Warn users',
        description: 'Issue and remove user warnings.'
      },
      {
        key: 'users_disable',
        label: 'Disable users',
        description: 'Enable or disable user accounts.'
      },
      {
        key: 'users_view_ips',
        label: 'View IP history',
        description: 'View per-user IP history.'
      },
      {
        key: 'users_view_email',
        label: 'View email history',
        description: 'View per-user email history.'
      },
      {
        key: 'recovery_manage',
        label: 'Manage recovery',
        description:
          'Manage account recovery requests and trigger recovery emails.'
      },
      {
        key: 'invites_manage',
        label: 'Manage invites',
        description: 'Access invite pool and invite tree tools.'
      },
      {
        key: 'ratio_policy_manage',
        label: 'Manage ratio policy',
        description: 'Manage ratio policy tools and ratio watch.'
      }
    ]
  },
  {
    key: 'operations',
    title: 'Operations',
    permissions: [
      {
        key: 'site_history_manage',
        label: 'Manage site history',
        description: 'Manage site history entries.'
      },
      {
        key: 'ip_bans_manage',
        label: 'Manage IP bans',
        description: 'Manage IP ban ranges.'
      },
      {
        key: 'email_blacklist_manage',
        label: 'Manage email blacklist',
        description: 'Manage blacklisted email domains and addresses.'
      },
      {
        key: 'donor_ranks_manage',
        label: 'Manage donor ranks',
        description: 'Manage donor ranks and donor assignments.'
      },
      {
        key: 'donation_log_view',
        label: 'View donation log',
        description: 'Access donation log and related finance read tools.'
      },
      {
        key: 'messages_mass_pm',
        label: 'Send mass PMs',
        description: 'Send site-wide mass private messages.'
      }
    ]
  },
  {
    key: 'staffTools',
    title: 'Staff Tools',
    permissions: [
      {
        key: 'login_watch_view',
        label: 'View login watch',
        description: 'Access login watch session tools.'
      },
      {
        key: 'duplicate_ips_view',
        label: 'View duplicate IPs',
        description: 'Access duplicate IP reports.'
      },
      {
        key: 'registration_log_view',
        label: 'View registration log',
        description: 'Access registration logs.'
      },
      {
        key: 'staff',
        label: 'General staff',
        description:
          'Access general staff-only surfaces not broken out further.'
      }
    ]
  },
  {
    key: 'administration',
    title: 'Administration',
    permissions: [
      {
        key: 'rank_permissions_manage',
        label: 'Manage rank permissions',
        description: 'Create, edit, and delete user ranks and permission sets.'
      },
      {
        key: 'staff_groups_manage',
        label: 'Manage staff groups',
        description: 'Create, edit, and delete staff groups.'
      },
      {
        key: 'admin',
        label: 'Administrator',
        description: 'Global administrative override.'
      }
    ]
  }
] as const;

type PermissionEntry =
  (typeof PERMISSION_GROUPS)[number]['permissions'][number];

export const VALID_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key)
) as [PermissionEntry['key'], ...PermissionEntry['key'][]];

export type Permission = (typeof VALID_PERMISSIONS)[number];

export type PermissionMap = Partial<Record<Permission, boolean>>;

export const permissionLabelByKey = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((permission) => [permission.key, permission.label])
  )
) as Record<Permission, string>;

export const ALL_PERMISSIONS = Object.fromEntries(
  VALID_PERMISSIONS.map((permission) => [permission, true])
) as Record<Permission, true>;

export const normalizePermissions = (
  permissions: Record<string, boolean> | null | undefined
): PermissionMap => {
  const normalized: PermissionMap = {};
  if (!permissions) return normalized;
  for (const key of VALID_PERMISSIONS) {
    if (permissions[key]) normalized[key] = true;
  }
  return normalized;
};

export const hasPermission = (
  permissions: Record<string, boolean> | null | undefined,
  permission: Permission
): boolean => {
  if (!permissions) return false;
  if (permissions.admin) return true;
  return !!permissions[permission];
};

export const hasAnyPermission = (
  permissions: Record<string, boolean> | null | undefined,
  required: Permission[]
): boolean =>
  required.some((permission) => hasPermission(permissions, permission));
