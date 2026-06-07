/**
 * PRD-03 stylesheet scoring — docs/prd/03-stylesheet-themes-and-scoring.md.
 *
 * Pure function: given a stylesheet-selection event, return the Community
 * Reputation Score (CRS) deltas for the selecting user, the site, and any
 * author/staff recipient. No DB — mirrors the pure-scoring style of ratio.ts.
 *
 * Weights are pinned from PRD-03 and flagged there as interpretation pending
 * confirmation; change the constants here + the spec together.
 */

export type StylesheetOrigin =
  | { kind: 'site'; isDefault: boolean } // built-in site stylesheet (default = Sublime)
  | { kind: 'staff'; authorId: number } // authored by a SysOp/staff user
  | { kind: 'external' } // user's own external stylesheet URL
  | { kind: 'author'; authorId: number }; // a user-authored stylesheet

export interface StylesheetSelection {
  userId: number;
  origin: StylesheetOrigin;
}

export interface CrsAccrual {
  /** CRS to the selecting user (reward for customizing). */
  user: number;
  /** CRS to the site's own KPI score. */
  site: number;
  /** CRS routed to a staff/author recipient, if any. */
  author: { userId: number; delta: number } | null;
}

const USER_BASE = 0.1;
const SITE_BASE = 0.1415926535;

export const scoreStylesheetSelection = (
  selection: StylesheetSelection
): CrsAccrual => {
  const { userId, origin } = selection;

  switch (origin.kind) {
    case 'site':
      // Built-in theme: site keeps its base; user reward doubles off-default.
      return {
        user: USER_BASE * (origin.isDefault ? 1 : 2),
        site: SITE_BASE,
        author: null
      };

    case 'staff':
      // Adopting a staff-authored theme: the x3 bonus is routed to that staff
      // member, not the site.
      return {
        user: USER_BASE * 3,
        site: 0,
        author: { userId: origin.authorId, delta: SITE_BASE * 3 }
      };

    case 'external':
      // Authorless external stylesheet: the user's customization still earns the
      // engagement reward, but NOTHING accrues to the site. An unowned external
      // .css/.scss is a prune/investigate candidate — or, if other users share it,
      // a hidden Community stylesheet — resolved at the permission / link-health
      // layer, not credited here. An external that resolves to an author is scored
      // as `author` instead.
      return { user: USER_BASE * 3, site: 0, author: null };

    case 'author': {
      const isSelf = origin.authorId === userId;
      // Self-use is not an adoption — pay only the user reward, no author bonus
      // (FLAG: PRD-03 anti-farm interpretation). Others adopting pay the author x5.
      return {
        user: USER_BASE * (isSelf ? 5 : 3),
        site: 0,
        author: isSelf
          ? null
          : { userId: origin.authorId, delta: SITE_BASE * 5 }
      };
    }
  }
};
