// Raw-content tags: their bodies are NOT parsed as BBCode. `plain` strips (emits
// its body verbatim with no wrapper); `code`/`pre`/`tex` wrap but keep the body
// literal. Kept in one place because the tokenizer, parser, and emitter all key
// off this set.
export const RAW_TAGS = ['plain', 'code', 'pre', 'tex'] as const;
export type RawTag = (typeof RAW_TAGS)[number];
export type WrappingRawTag = Exclude<RawTag, 'plain'>;

export type Token =
  | { type: 'text'; value: string }
  | { type: 'open'; tag: string; arg?: string }
  | { type: 'close'; tag: string }
  // `plain` is folded into a text token by the tokenizer; only the wrapping raw
  // tags reach the parser as a raw token.
  | { type: 'raw'; tag: WrappingRawTag; content: string }
  | { type: 'item'; ordered: boolean }; // [*] (ul) or [#] (ol)

// Loose lists are synthesized into `ul`/`ol`/`li` element nodes by the parser, so
// the tree needs only three node kinds.
export type Node =
  | { kind: 'text'; value: string }
  | { kind: 'element'; tag: string; arg?: string; children: Node[] }
  | { kind: 'raw'; tag: WrappingRawTag; content: string };
