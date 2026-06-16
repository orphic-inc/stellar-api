/**
 * InviteTree — the who-invited-whom topology (#61).
 *
 * Pure assembly + summary over adjacency rows: each member carries an
 * `inviterId` pointing at whoever invited them. The DB read (a recursive walk)
 * and the paranoia decision live in the read/route layer; these functions are
 * pure so the tree shape and aggregate stats are deterministically testable —
 * the same style as `computeStanding` / `ruleImpact`.
 *
 * The same topology is what ADR-0004 **Contagion** will later walk (an infected
 * trunk casts graded, distance-decaying suspicion over its branches); this slice
 * builds the substrate, not that governance signal.
 */
import { computeRatio } from './ratio';

/** A member row as fetched for the tree — the member plus their inviter pointer. */
export interface InviteTreeRow {
  userId: number;
  /** Whoever invited this member; null for a tree root (no inviter). */
  inviterId: number | null;
  username: string;
  disabled: boolean;
  rankName: string;
  isDonor: boolean;
  contributed: bigint;
  consumed: bigint;
  /** False when the member's paranoia hides their byte stats from the viewer. */
  statsVisible: boolean;
}

export interface InviteTreeNode {
  userId: number;
  username: string;
  disabled: boolean;
  rankName: string;
  isDonor: boolean;
  /** 1 for a direct invitee of the root, +1 per level below. */
  depth: number;
  contributed: bigint;
  consumed: bigint;
  statsVisible: boolean;
  children: InviteTreeNode[];
}

export interface RatioStats {
  contributed: string;
  consumed: string;
  ratio: string;
}

export interface InviteTreeSummary {
  /** Total descendants (the root itself is the anchor, not counted). */
  entries: number;
  /** Direct invitees of the root. */
  branches: number;
  /** Depth of the deepest descendant (direct invitees are depth 1). */
  depth: number;
  disabledCount: number;
  donorCount: number;
  /** Descendants whose stats are paranoia-hidden from the viewer. */
  hiddenCount: number;
  byRank: { rankName: string; count: number }[];
  /** Whole-subtree contributed/consumed + ratio — includes paranoia-hidden members. */
  total: RatioStats;
  /** Direct-invitee (top level) contributed/consumed + ratio. */
  topLevel: RatioStats;
}

const fmtStats = (contributed: bigint, consumed: bigint): RatioStats => ({
  contributed: contributed.toString(),
  consumed: consumed.toString(),
  ratio: computeRatio(contributed, consumed).toFixed(2)
});

/**
 * Assemble flat adjacency rows into the subtree rooted at `rootUserId`. The rows
 * are the root's descendants (the root is the anchor, never a node). Siblings are
 * ordered by username for a stable render. A `seen` set guards against cycles in
 * corrupt data so a malformed edge can't loop forever.
 */
export const buildInviteSubtree = (
  rows: InviteTreeRow[],
  rootUserId: number
): InviteTreeNode[] => {
  const byInviter = new Map<number, InviteTreeRow[]>();
  for (const r of rows) {
    if (r.inviterId === null) continue;
    const list = byInviter.get(r.inviterId);
    if (list) list.push(r);
    else byInviter.set(r.inviterId, [r]);
  }

  const seen = new Set<number>([rootUserId]);
  const build = (inviterId: number, depth: number): InviteTreeNode[] =>
    (byInviter.get(inviterId) ?? [])
      .filter((r) => !seen.has(r.userId))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((r) => {
        seen.add(r.userId);
        return {
          userId: r.userId,
          username: r.username,
          disabled: r.disabled,
          rankName: r.rankName,
          isDonor: r.isDonor,
          depth,
          contributed: r.contributed,
          consumed: r.consumed,
          statsVisible: r.statsVisible,
          children: build(r.userId, depth + 1)
        };
      });

  return build(rootUserId, 1);
};

/**
 * Aggregate an assembled subtree. Byte totals include every descendant —
 * paranoia hides a member's stats from *display*, never from the aggregate
 * (an inviter is answerable for their whole tree's footprint).
 */
export const summarizeInviteTree = (
  roots: InviteTreeNode[]
): InviteTreeSummary => {
  let entries = 0;
  let disabledCount = 0;
  let donorCount = 0;
  let hiddenCount = 0;
  let depth = 0;
  let totalContributed = 0n;
  let totalConsumed = 0n;
  const rankCounts = new Map<string, number>();

  const walk = (nodes: InviteTreeNode[]): void => {
    for (const n of nodes) {
      entries++;
      if (n.disabled) disabledCount++;
      if (n.isDonor) donorCount++;
      if (!n.statsVisible) hiddenCount++;
      if (n.depth > depth) depth = n.depth;
      totalContributed += n.contributed;
      totalConsumed += n.consumed;
      rankCounts.set(n.rankName, (rankCounts.get(n.rankName) ?? 0) + 1);
      walk(n.children);
    }
  };
  walk(roots);

  let topContributed = 0n;
  let topConsumed = 0n;
  for (const n of roots) {
    topContributed += n.contributed;
    topConsumed += n.consumed;
  }

  return {
    entries,
    branches: roots.length,
    depth,
    disabledCount,
    donorCount,
    hiddenCount,
    byRank: [...rankCounts.entries()]
      .map(([rankName, count]) => ({ rankName, count }))
      .sort(
        (a, b) => b.count - a.count || a.rankName.localeCompare(b.rankName)
      ),
    total: fmtStats(totalContributed, totalConsumed),
    topLevel: fmtStats(topContributed, topConsumed)
  };
};
