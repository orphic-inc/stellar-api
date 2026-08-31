/**
 * Community membership projection to korin (ADR-0030 Decision 4, #328).
 *
 * stellar owns "who may see community X"; korin owns the IRC substrate that
 * enforces it. This module answers the first half and pushes it: for each
 * PRIVATE community, the complete set of eligible **verified** IRC nicks, sent
 * to korin's `POST /irc/membership`, which overwrites its channel ACL from it.
 *
 * korin's copy is a **disposable materialized view** — replaced, never diffed —
 * so it self-heals across a korin restart and needs no reseed protocol.
 *
 * Full set, not deltas. Membership here is *derived* from roughly eight
 * scattered mutation points (member/curator/contributor add and remove, leader
 * change, nick verify/unverify, disable/ban, a visibility flip) with no single
 * choke-point to instrument. A full-set replace has nothing to miss; per-seam
 * delta emission would have eight places to forget.
 *
 * Staleness is costless here by construction: the flag gates announcement
 * *visibility only, never a download* (ADR-0015, Golden Rule 3). The worst case
 * from a late tick is a just-removed member seeing that a release *exists* for
 * up to one interval. Never access.
 */
import { prisma } from '../lib/prisma';
import { korin } from './config';
import { listCommunityMembers } from './communityAccess';
import { getLogger } from './logging';

const log = getLogger('membershipProjection');

/**
 * Every community whose announces route to a gated channel.
 *
 * PUBLIC communities are excluded because they have no `#c-<id>` to gate —
 * their lines go to the `#announce` firehose, which has no ACL to project.
 */
export const listPrivateCommunityIds = async (): Promise<number[]> => {
  const rows = await prisma.community.findMany({
    where: { announceVisibility: 'PRIVATE' },
    select: { id: true },
    orderBy: { id: 'asc' }
  });
  return rows.map((r) => r.id);
};

/**
 * The eligible verified-nick set for one community.
 *
 * Deliberately composed from `listCommunityMembers` rather than re-deriving the
 * role arms. `communityAccess.ts` states that the union's arms must stay in
 * agreement across their call-sites and backs it with a test; a fifth place
 * enumerating `consumer ∪ contributor ∪ curator ∪ leader` would be exactly the
 * drift that warning is about. The cost is one extra query per community per
 * tick, which at a five-minute interval is not worth trading correctness for.
 *
 * Two filters beyond membership, and both are deliberate:
 *
 * - `ircNick: { not: null }` — `ircNick` holds only a *verified* nick by
 *   construction (ADR-0015); an unproven Nick Claim lives in `pendingIrcNick`
 *   and must never reach a channel ACL, or claiming a nick would grant another
 *   member's visibility.
 * - `disabled: false` — a disabled account is a membership mutation point the
 *   role relations do not reflect on their own; leaving them in would keep a
 *   banned member in the channel until someone unwound their roles.
 *
 * Note site staff (`communities_manage`/`admin`) are **not** here. That is an
 * Axis-2 global capability, not membership: a site staffer is not a member of
 * every private community and must not populate its channel (ADR-0030
 * Decision 2).
 */
export const getCommunityMemberNicks = async (
  communityId: number
): Promise<string[]> => {
  const members = await listCommunityMembers(communityId);
  if (members.length === 0) return [];

  const withNicks = await prisma.user.findMany({
    where: {
      id: { in: members.map((m) => m.id) },
      ircNick: { not: null },
      disabled: false
    },
    select: { ircNick: true }
  });

  // Sorted so a projection is diffable in logs and stable across ticks; korin
  // overwrites wholesale either way, so order carries no meaning on the wire.
  return withNicks.map((u) => u.ircNick as string).sort();
};

/**
 * Push one community's full nick set to korin. Returns true on a 2xx.
 *
 * An **empty set is projected verbatim** — korin overwrites the ACL to empty.
 * A memberless private community is not special-cased, because "nobody may see
 * this" is a legitimate state and skipping the push would leave korin holding a
 * stale ACL that stellar believes it has replaced.
 *
 * stellar ignores the response body, mirroring `publishAnnounceItem`.
 */
export const projectCommunityMembership = async (
  communityId: number,
  nicks: string[]
): Promise<boolean> => {
  const { apiUrl, pullKey } = korin;
  if (!apiUrl || !pullKey) return false;

  try {
    const res = await fetch(`${apiUrl}/irc/membership`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pull-key': pullKey },
      // Pinned contract (ADR-0030): numeric Community.id, never a name or slug —
      // korin derives `#c-<id>` from it, so the channel survives a rename.
      body: JSON.stringify({ community: communityId, nicks })
    });
    if (!res.ok) {
      log.warn('korin /irc/membership returned non-2xx', {
        status: res.status,
        communityId,
        nickCount: nicks.length
      });
      return false;
    }
    return true;
  } catch (err) {
    log.error('Failed to project membership to korin', {
      communityId,
      err: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
};

/** Read one community's eligible nicks and project them. */
export const reconcileCommunityMembership = async (
  communityId: number
): Promise<boolean> => {
  const nicks = await getCommunityMemberNicks(communityId);
  return projectCommunityMembership(communityId, nicks);
};
