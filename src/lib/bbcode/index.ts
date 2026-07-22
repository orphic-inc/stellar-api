import { createHash } from 'crypto';
import { TtlCache } from '../ttlCache';
import { BBCtx } from './ctx';
import { parse } from './parse';
import { render } from './render';
import { resolveRefs } from './resolve';
import { sanitizeBBCode } from './sanitizeConfig';
import { tokenize } from './tokenize';
import { PARSER_VERSION } from './version';

export type { BBCtx } from './ctx';

const RENDER_TTL_MS = 10 * 60 * 1000; // 10 min — the staleness bound for DB tags (#398 Q16)
const cache = new TtlCache();

function cacheKey(raw: string, ctx: BBCtx): string {
  const hash = createHash('sha256').update(raw).digest('hex');
  // Viewer-independent today; when [mature] gates on a setting (#400) the render
  // diverges per viewer and this key must gain that dimension.
  const mature = ctx.viewer ? (ctx.viewer.showMature ? '1' : '0') : '-';
  return `bbcode:v${PARSER_VERSION}:m${mature}:${hash}`;
}

// Render-time transcription of BBCode to sanitized HTML. Store raw BBCode; call
// this on read. The API is the single source of transcription (#398).
export async function renderBBCode(raw: string, ctx: BBCtx): Promise<string> {
  if (!raw) return '';

  const key = cacheKey(raw, ctx);
  const cached = cache.get<string>(key);
  if (cached !== undefined) return cached;

  const tree = parse(tokenize(raw));
  const maps = await resolveRefs(tree, ctx);
  const html = sanitizeBBCode(render(tree, maps, ctx));

  cache.set(key, html, RENDER_TTL_MS);
  return html;
}
