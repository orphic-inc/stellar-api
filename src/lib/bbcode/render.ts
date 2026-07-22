import katex from 'katex';
import { BBCtx } from './ctx';
import { extractReleaseId, ResolveMaps } from './resolve';
import { Node } from './types';

// [size=n], n in 1..10 (2 = normal). Relative units so themes scale it (#398 Q9).
const SIZE_EM = [0.85, 1, 1.15, 1.35, 1.6, 1.9, 2.2, 2.5, 2.8, 3.2];

const HEX = /^#[0-9a-f]{6}$/i;
const NAMED = /^[a-z]+$/i; // letters-only named colors are safe in a style value
const RULE_CODE = /^h?\d+(?:\.\d+)*$/;
const IMG_EXT = /\.(gif|jpe?g|png)$/i;

const escapeText = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeFlow = (s: string): string => escapeText(s).replace(/\n/g, '<br>');

// href lives in a double-quoted attribute; safeUrl has already gated the scheme.
const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '%22').replace(/'/g, '%27');

function safeUrl(u: string): string | null {
  const s = u.trim();
  if (/^https?:\/\//i.test(s) || s.startsWith('/') || s.startsWith('mailto:'))
    return s;
  return null;
}

function textContent(node: Node): string {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'raw') return node.content;
  return node.children.map(textContent).join('');
}

interface Opts {
  autoLink: boolean; // false inside links, so we never nest an <a> in an <a>
}

function anchor(href: string, display: string, external: boolean): string {
  const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
  return `<a href="${escapeAttr(href)}"${rel}>${display}</a>`;
}

// On-site URLs display as their path only; off-site display in full (#398 Q12).
function linkFromUrl(url: string, ctx: BBCtx): string {
  const safe = safeUrl(url);
  if (!safe) return escapeFlow(url);
  const external = /^https?:\/\//i.test(safe) || safe.startsWith('mailto:');
  let display = safe;
  if (ctx.siteUrl && safe.startsWith(ctx.siteUrl)) {
    display = safe.slice(ctx.siteUrl.length) || '/';
  }
  return anchor(
    safe,
    escapeText(display),
    external && !safe.startsWith(ctx.siteUrl)
  );
}

// [tex] is a raw-content tag: its body is literal LaTeX, rendered server-side by
// KaTeX (#403). The output (MathML + HTML spans + a little SVG) is passed through
// the sanitize allowlist like everything else. `throwOnError: false` renders a
// parse error inline as a red node rather than throwing; the try/catch is the
// belt-and-suspenders so a render-at-read call can never 500 — on any failure we
// fall back to the Phase 1 literal-source rendering.
function renderTex(src: string): string {
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      output: 'htmlAndMathml'
    });
  } catch {
    return `<code class="bbcode-tex">${escapeText(src)}</code>`;
  }
}

function emitText(value: string, ctx: BBCtx, opts: Opts): string {
  if (!opts.autoLink) return escapeFlow(value);
  // Spec: bare URLs auto-hyperlink. Never re-link inside an existing link, a
  // raw block, or `[plain]` (those never reach here with autoLink on).
  const re = /https?:\/\/[^\s<>")\]]+/gi;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    out += escapeFlow(value.slice(last, m.index));
    out += linkFromUrl(m[0], ctx);
    last = m.index + m[0].length;
  }
  out += escapeFlow(value.slice(last));
  return out;
}

function emitChildren(
  nodes: Node[],
  maps: ResolveMaps,
  ctx: BBCtx,
  opts: Opts
): string {
  return nodes.map((n) => emitNode(n, maps, ctx, opts)).join('');
}

function emitElement(
  node: Node & { kind: 'element' },
  maps: ResolveMaps,
  ctx: BBCtx,
  opts: Opts
): string {
  const { tag, arg } = node;
  const inner = () => emitChildren(node.children, maps, ctx, opts);
  const body = () => textContent(node).trim();

  switch (tag) {
    case 'b':
      return `<strong>${inner()}</strong>`;
    case 'i':
      return `<em>${inner()}</em>`;
    case 'u':
      return `<u>${inner()}</u>`;
    case 's':
      return `<s>${inner()}</s>`;
    case 'important':
      return `<span class="bbcode-important">${inner()}</span>`;
    case 'h2':
    case 'h3':
    case 'h4':
      return `<${tag}>${inner()}</${tag}>`;

    case 'color': {
      const v = (arg ?? '').trim();
      if (HEX.test(v) || NAMED.test(v))
        return `<span style="color:${v}">${inner()}</span>`;
      return inner(); // invalid value: drop the styling, keep the text
    }
    case 'size': {
      const n = /^\d+$/.test(arg ?? '') ? parseInt(arg!, 10) : NaN;
      if (n >= 1 && n <= 10)
        return `<span style="font-size:${SIZE_EM[n - 1]}em">${inner()}</span>`;
      return inner();
    }
    case 'align': {
      const v = (arg ?? '').trim().toLowerCase();
      if (v === 'left' || v === 'right' || v === 'center')
        return `<div style="text-align:${v}">${inner()}</div>`;
      return inner();
    }

    case 'url': {
      if (arg !== undefined) {
        const safe = safeUrl(arg);
        const label = emitChildren(node.children, maps, ctx, {
          autoLink: false
        });
        if (!safe) return label;
        const external =
          /^https?:\/\//i.test(safe) || safe.startsWith('mailto:');
        return anchor(safe, label, external);
      }
      return linkFromUrl(body(), ctx);
    }
    case 'img': {
      const src = body();
      if (/^https?:\/\//i.test(src) && IMG_EXT.test(src))
        return `<img src="${escapeAttr(src)}" alt="" class="bbcode-img" />`;
      return escapeFlow(src);
    }

    case 'quote': {
      const content = inner();
      if (!arg)
        return `<blockquote class="bbcode-quote">${content}</blockquote>`;
      const bar = arg.indexOf('|');
      const who = escapeText((bar === -1 ? arg : arg.slice(0, bar)).trim());
      let cite = `${who} wrote:`;
      if (bar !== -1) {
        const pid = parseInt(arg.slice(bar + 1).trim(), 10);
        const post = maps.postsById.get(pid);
        if (post)
          cite = anchor(
            `/forums/${post.forumId}/topics/${post.forumTopicId}#post-${post.id}`,
            `${who} wrote:`,
            false
          );
      }
      return `<blockquote class="bbcode-quote"><cite>${cite}</cite>${content}</blockquote>`;
    }
    case 'hide': {
      const summary = escapeText((arg ?? 'Hidden text').trim());
      return `<details class="bbcode-hide"><summary>${summary}</summary>${inner()}</details>`;
    }
    case 'mature': {
      // Phase 1: no viewer gate yet (#400) — a collapsed disclosure, content still
      // present. When `ctx.viewer.showMature` lands this branch omits the content
      // server-side when off, and the render becomes viewer-dependent (cache dim).
      const summary = escapeText((arg ?? 'Mature content').trim());
      return `<details class="bbcode-mature"><summary>${summary}</summary>${inner()}</details>`;
    }

    case 'ul':
    case 'ol': {
      const items = node.children
        .filter(
          (c): c is Node & { kind: 'element' } =>
            c.kind === 'element' && c.tag === 'li'
        )
        .map((li) => {
          // The item's line break rides along in its text; drop the trailing one.
          const c = emitChildren(li.children, maps, ctx, opts)
            .trim()
            .replace(/(?:<br>)+$/, '');
          return `<li>${c}</li>`;
        })
        .join('');
      return `<${tag} class="bbcode-list">${items}</${tag}>`;
    }
    case 'li':
      // Only reached if an <li> escaped its list; render defensively.
      return `<li>${inner()}</li>`;

    case 'rule': {
      const code = body();
      if (!RULE_CODE.test(code)) return escapeText(code);
      const anchorId = code.replace(/^h/i, '');
      return anchor(`/rules#${anchorId}`, escapeText(code), false);
    }
    case 'user': {
      const raw = body();
      const hit = /^\d+$/.test(raw)
        ? maps.usersById.get(parseInt(raw, 10))
        : maps.usersByName.get(raw.toLowerCase());
      if (!hit) return escapeText(raw);
      return anchor(`/user/${hit.id}`, escapeText(hit.username), false);
    }
    case 'artist': {
      const name = body();
      const hit = maps.artistsByName.get(name.toLowerCase());
      if (!hit) return escapeText(name);
      return anchor(`/artists/${hit.id}`, escapeText(hit.name), false);
    }
    case 'release': {
      const raw = body();
      const id = extractReleaseId(raw);
      const hit = id !== null ? maps.releasesById.get(id) : undefined;
      if (!hit || hit.communityId == null) return escapeText(raw);
      return anchor(
        `/communities/${hit.communityId}/releases/${hit.id}`,
        escapeText(raw),
        false
      );
    }
    case 'wikilink': {
      const ref = (arg ?? '').trim();
      const hit = maps.wikisByRef.get(ref.toLowerCase());
      if (!hit) return escapeText(ref);
      return anchor(`/wiki/${hit.id}`, escapeText(hit.title), false);
    }

    default:
      // Unknown tags never reach here (the parser turns them into text), but be safe.
      return inner();
  }
}

function emitNode(
  node: Node,
  maps: ResolveMaps,
  ctx: BBCtx,
  opts: Opts
): string {
  if (node.kind === 'text') return emitText(node.value, ctx, opts);
  if (node.kind === 'raw') {
    if (node.tag === 'pre')
      return `<pre class="bbcode-pre">${escapeText(node.content)}</pre>`;
    if (node.tag === 'code')
      return `<code class="bbcode-code">${escapeText(node.content)}</code>`;
    return renderTex(node.content);
  }
  return emitElement(node, maps, ctx, opts);
}

export function render(nodes: Node[], maps: ResolveMaps, ctx: BBCtx): string {
  return emitChildren(nodes, maps, ctx, { autoLink: true });
}
