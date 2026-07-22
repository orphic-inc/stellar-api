import { Node, Token } from './types';

// Tags that become elements. Anything else that arrives as a clean tag is
// unknown and degrades to literal text (lenient case 1). `ul`/`ol`/`li` are
// never authored — the parser synthesizes them from `[*]`/`[#]` items.
const ELEMENT_TAGS = new Set([
  'b',
  'i',
  'u',
  's',
  'color',
  'size',
  'url',
  'img',
  'artist',
  'user',
  'release',
  'important',
  'quote',
  'align',
  'hide',
  'mature',
  'rule',
  'wikilink',
  'h2',
  'h3',
  'h4'
]);

// Block-level tags force an open loose list to close before they open.
const BLOCK_TAGS = new Set([
  'quote',
  'align',
  'hide',
  'mature',
  'h2',
  'h3',
  'h4'
]);

type Frame = { tag: string; arg?: string; children: Node[] };

function literalOpen(tag: string, arg?: string): string {
  return arg !== undefined ? `[${tag}=${arg}]` : `[${tag}]`;
}

export function parse(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Frame[] = [];

  const top = (): Frame | undefined => stack[stack.length - 1];
  const childrenOf = (): Node[] =>
    stack.length ? stack[stack.length - 1].children : root;

  const pushEl = (tag: string, arg?: string) =>
    stack.push({ tag, arg, children: [] });
  const popAsNode = () => {
    const el = stack.pop();
    if (!el) return;
    childrenOf().push({
      kind: 'element',
      tag: el.tag,
      arg: el.arg,
      children: el.children
    });
  };

  const appendText = (value: string) =>
    childrenOf().push({ kind: 'text', value });

  const inListItem = () => top()?.tag === 'li';

  const closeLooseList = () => {
    if (top()?.tag === 'li') popAsNode();
    const t = top()?.tag;
    if (t === 'ul' || t === 'ol') popAsNode();
  };

  const ensureListItem = (ordered: boolean) => {
    const listTag = ordered ? 'ol' : 'ul';
    if (top()?.tag === 'li') popAsNode();
    if (top()?.tag !== listTag) {
      const t = top()?.tag;
      if (t === 'ul' || t === 'ol') popAsNode(); // switching list type mid-run
      pushEl(listTag);
    }
    pushEl('li');
  };

  for (const tok of tokens) {
    switch (tok.type) {
      case 'item':
        ensureListItem(tok.ordered);
        break;

      case 'text': {
        // A blank line ends a loose list; the remainder rejoins normal flow.
        if (inListItem()) {
          const idx = tok.value.indexOf('\n\n');
          if (idx === -1) {
            appendText(tok.value);
          } else {
            const before = tok.value.slice(0, idx);
            if (before) appendText(before);
            closeLooseList();
            const after = tok.value.slice(idx);
            if (after) appendText(after);
          }
        } else {
          appendText(tok.value);
        }
        break;
      }

      case 'raw':
        childrenOf().push({ kind: 'raw', tag: tok.tag, content: tok.content });
        break;

      case 'open': {
        // `[list]` is a tolerated, transparent wrapper — the `[*]` items inside
        // synthesize the real list, so the wrapper itself is a no-op.
        if (tok.tag === 'list') break;

        if (!ELEMENT_TAGS.has(tok.tag)) {
          appendText(literalOpen(tok.tag, tok.arg));
          break;
        }
        if (BLOCK_TAGS.has(tok.tag)) closeLooseList();
        pushEl(tok.tag, tok.arg);
        break;
      }

      case 'close': {
        if (tok.tag === 'list') break;

        let idx = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === tok.tag) {
            idx = k;
            break;
          }
        }
        if (idx === -1) {
          // Stray close with no matching open -> literal text (lenient case 3).
          appendText(`[/${tok.tag}]`);
          break;
        }
        // Auto-close everything above the match, then the match itself
        // (lenient case 4). Force-closed inners leave their own later close
        // tags stray, which fall to case 3.
        while (stack.length > idx) popAsNode();
        break;
      }
    }
  }

  // Unbalanced opens auto-close at end of input (lenient case 2).
  while (stack.length) popAsNode();

  return root;
}
