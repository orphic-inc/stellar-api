import { prisma } from '../lib/prisma';
import { renderBBCode } from '../lib/bbcode';
import { email } from './config';

// The one place that wires the app's prisma singleton + site URL into the
// decoupled BBCode renderer (the lib itself takes an injected ctx). Every prose
// surface renders BBCode at read time through this, so routes don't each repeat
// the ctx and the render-at-read policy has a single seam (#398/#402). When the
// `[mature]` viewer gate lands (#400) the viewer dimension threads through here.
export function renderSiteBBCode(
  raw: string | null | undefined
): Promise<string> {
  return renderBBCode(raw ?? '', { db: prisma, siteUrl: email.siteUrl });
}

// Attach an additive, rendered `bodyHtml` next to a row's raw `body` — the shape
// UI display surfaces consume so they can stop parsing BBCode client-side. The
// raw `body` is unchanged and still round-trips the editor (#402).
export async function withBodyHtml<T extends { body: string }>(
  row: T
): Promise<T & { bodyHtml: string }> {
  return { ...row, bodyHtml: await renderSiteBBCode(row.body) };
}
