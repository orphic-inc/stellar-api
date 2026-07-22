import { BBCtx } from './ctx';
import { Node } from './types';

// Batch-resolved lookup maps for the DB-dependent tags. Pass 1 collects the
// references from the tree; one query per type fills these; pass 2 (render)
// reads them. Unresolved references fall back to plain text (#398 Q5).
export interface ResolveMaps {
  usersById: Map<number, { id: number; username: string }>;
  usersByName: Map<string, { id: number; username: string }>;
  artistsByName: Map<string, { id: number; name: string }>;
  releasesById: Map<number, { id: number; communityId: number | null }>;
  wikisByRef: Map<string, { id: number; title: string }>;
  postsById: Map<number, { id: number; forumTopicId: number; forumId: number }>;
}

function textContent(node: Node): string {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'raw') return node.content;
  return node.children.map(textContent).join('');
}

// A [release] body is either a bare group id or an on-site release URL.
export function extractReleaseId(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /\/releases\/(\d+)/.exec(s);
  return m ? parseInt(m[1], 10) : null;
}

interface Refs {
  userIds: Set<number>;
  userNames: Set<string>;
  artistNames: Set<string>;
  releaseIds: Set<number>;
  wikiRefs: Set<string>;
  postIds: Set<number>;
}

function collect(nodes: Node[], refs: Refs): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue;
    switch (node.tag) {
      case 'user': {
        const body = textContent(node).trim();
        if (/^\d+$/.test(body)) refs.userIds.add(parseInt(body, 10));
        else if (body) refs.userNames.add(body.toLowerCase());
        break;
      }
      case 'artist': {
        const name = textContent(node).trim();
        if (name) refs.artistNames.add(name.toLowerCase());
        break;
      }
      case 'release': {
        const id = extractReleaseId(textContent(node));
        if (id !== null) refs.releaseIds.add(id);
        break;
      }
      case 'wikilink': {
        const ref = (node.arg ?? '').trim();
        if (ref) refs.wikiRefs.add(ref.toLowerCase());
        break;
      }
      case 'quote': {
        const arg = node.arg ?? '';
        const bar = arg.indexOf('|');
        if (bar !== -1) {
          const pid = parseInt(arg.slice(bar + 1).trim(), 10);
          if (!Number.isNaN(pid)) refs.postIds.add(pid);
        }
        break;
      }
    }
    collect(node.children, refs);
  }
}

const empty = (): ResolveMaps => ({
  usersById: new Map(),
  usersByName: new Map(),
  artistsByName: new Map(),
  releasesById: new Map(),
  wikisByRef: new Map(),
  postsById: new Map()
});

export async function resolveRefs(
  nodes: Node[],
  ctx: BBCtx
): Promise<ResolveMaps> {
  const refs: Refs = {
    userIds: new Set(),
    userNames: new Set(),
    artistNames: new Set(),
    releaseIds: new Set(),
    wikiRefs: new Set(),
    postIds: new Set()
  };
  collect(nodes, refs);

  const maps = empty();
  const db = ctx.db;

  const jobs: Promise<void>[] = [];

  if (refs.userIds.size || refs.userNames.size) {
    jobs.push(
      db.user
        .findMany({
          where: {
            OR: [
              { id: { in: [...refs.userIds] } },
              { username: { in: [...refs.userNames], mode: 'insensitive' } }
            ]
          },
          select: { id: true, username: true }
        })
        .then((rows) => {
          for (const r of rows) {
            maps.usersById.set(r.id, r);
            maps.usersByName.set(r.username.toLowerCase(), r);
          }
        })
    );
  }

  if (refs.artistNames.size) {
    jobs.push(
      db.artist
        .findMany({
          where: { name: { in: [...refs.artistNames], mode: 'insensitive' } },
          select: { id: true, name: true }
        })
        .then((rows) => {
          for (const r of rows) maps.artistsByName.set(r.name.toLowerCase(), r);
        })
    );
  }

  if (refs.releaseIds.size) {
    jobs.push(
      db.release
        .findMany({
          where: { id: { in: [...refs.releaseIds] } },
          select: { id: true, communityId: true }
        })
        .then((rows) => {
          for (const r of rows) maps.releasesById.set(r.id, r);
        })
    );
  }

  if (refs.wikiRefs.size) {
    const refList = [...refs.wikiRefs];
    // A wiki ref matches a page slug, an exact title, or an alias (#398 Q6).
    jobs.push(
      db.wikiPage
        .findMany({
          where: {
            OR: [
              { slug: { in: refList, mode: 'insensitive' } },
              { title: { in: refList, mode: 'insensitive' } }
            ]
          },
          select: { id: true, title: true, slug: true }
        })
        .then((rows) => {
          for (const r of rows) {
            maps.wikisByRef.set(r.slug.toLowerCase(), r);
            maps.wikisByRef.set(r.title.toLowerCase(), r);
          }
        })
    );
    jobs.push(
      db.wikiAlias
        .findMany({
          where: { alias: { in: refList, mode: 'insensitive' } },
          select: { alias: true, page: { select: { id: true, title: true } } }
        })
        .then((rows) => {
          for (const r of rows)
            maps.wikisByRef.set(r.alias.toLowerCase(), r.page);
        })
    );
  }

  if (refs.postIds.size) {
    jobs.push(
      db.forumPost
        .findMany({
          where: { id: { in: [...refs.postIds] } },
          select: {
            id: true,
            forumTopicId: true,
            forumTopic: { select: { forumId: true } }
          }
        })
        .then((rows) => {
          for (const r of rows) {
            maps.postsById.set(r.id, {
              id: r.id,
              forumTopicId: r.forumTopicId,
              forumId: r.forumTopic.forumId
            });
          }
        })
    );
  }

  await Promise.all(jobs);
  return maps;
}
