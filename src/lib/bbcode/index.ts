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

// Only content that actually carries a [mature] tag renders differently per viewer
// (#400). Everything else -- the overwhelming majority of prose -- is identical for
// both, so keying it per viewer would store two copies of the same HTML and double
// a cache that has no eviction bound (recorded on #575).
//
// Matched case-insensitively because the tokenizer lowercases tags, so [MATURE] is
// a real tag. The test is deliberately crude: a false positive costs one extra
// cache entry, while a false negative would let two viewers share one entry and see
// each other's gate decision. So it does not try to exclude a [mature] appearing
// inside a raw [code]/[plain] block -- erring toward varying is the safe direction.
const MATURE_TAG_RE = /\[mature[\]=]/i;

function cacheKey(raw: string, ctx: BBCtx): string {
  const hash = createHash('sha256').update(raw).digest('hex');
  const mature = MATURE_TAG_RE.test(raw)
    ? ctx.viewer.showMature
      ? '1'
      : '0'
    : 'x';
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
