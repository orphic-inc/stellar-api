import { parse } from './parse';
import { tokenize } from './tokenize';
import { Node } from './types';

// What counts as a remote image in BBCode, in one place (#737, ADR-0051). The
// renderer draws an `[img]` only when this holds, and the importer fetches
// exactly the URLs it holds for, so "what is imported" and "what renders as an
// image" cannot drift apart.
const IMG_EXT = /\.(gif|jpe?g|png)$/i;

export const isRemoteImageSrc = (src: string): boolean =>
  /^https?:\/\//i.test(src) && IMG_EXT.test(src);

function textContent(node: Node): string {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'raw') return node.content;
  return node.children.map(textContent).join('');
}

function collect(nodes: Node[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue;
    if (node.tag === 'img') {
      const src = textContent(node).trim();
      if (isRemoteImageSrc(src)) out.add(src);
      continue;
    }
    collect(node.children, out);
  }
}

/** Every distinct remote image URL a BBCode body would render as an image. */
export function remoteImageUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  collect(parse(tokenize(raw)), out);
  return [...out];
}
