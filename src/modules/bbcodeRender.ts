import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { renderBBCode } from '../lib/bbcode';
import { email } from './config';

// What the renderer needs to know about the person reading. Resolved once per
// request and passed down, never re-read per row (#400).
export type BBViewer = { showMature: boolean };

// The gate fails CLOSED. An unauthenticated caller, or a user whose settings row
// is somehow missing, gets the hidden treatment rather than the content.
const GATED: BBViewer = { showMature: false };

/**
 * Resolve the viewer's `[mature]` preference for this request.
 *
 * Call this ONCE per handler and thread the result. It must not be called inside
 * a `.map()` over rows: four render sites (comments, collages, contributions,
 * the staff roster) render inside a loop over a paginated list, so a per-row
 * lookup would issue one identical query per row. An integration test pins the
 * query count for exactly this reason.
 *
 * The lookup lives here rather than in the auth middleware on purpose. Widening
 * `req.user` would put a display preference on a hot path that every request
 * pays for, in a file AGENTS.md flags as high-risk, to serve the minority of
 * requests that render prose. Revisit if measurement says otherwise (#400).
 */
export async function resolveViewer(req: Request): Promise<BBViewer> {
  const userId = req.user?.id;
  if (!userId) return GATED;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettings: { select: { showMatureContent: true } } }
  });

  return { showMature: row?.userSettings?.showMatureContent ?? false };
}

// The one place that wires the app's prisma singleton + site URL into the
// decoupled BBCode renderer (the lib itself takes an injected ctx). Every prose
// surface renders BBCode at read time through this, so routes don't each repeat
// the ctx and the render-at-read policy has a single seam (#398/#402).
//
// `viewer` is required, not optional: rendering is viewer-dependent since #400,
// and an optional parameter would let a call site silently render ungated.
export function renderSiteBBCode(
  raw: string | null | undefined,
  viewer: BBViewer
): Promise<string> {
  return renderBBCode(raw ?? '', {
    db: prisma,
    siteUrl: email.siteUrl,
    viewer
  });
}

// Attach an additive, rendered `bodyHtml` next to a row's raw `body` — the shape
// UI display surfaces consume so they can stop parsing BBCode client-side. The
// raw `body` is unchanged and still round-trips the editor (#402), which is why
// the `[mature]` gate is a display preference rather than an access control: the
// gated text is still in `body` on the same response (#400).
export async function withBodyHtml<T extends { body: string }>(
  row: T,
  viewer: BBViewer
): Promise<T & { bodyHtml: string }> {
  return { ...row, bodyHtml: await renderSiteBBCode(row.body, viewer) };
}
