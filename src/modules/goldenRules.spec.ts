/**
 * Drift-guard — proves the structured Golden Rules seed (`GOLDEN_RULES`) is a
 * faithful mirror of the canonical prose in `CODE_OF_CONDUCT.md`. If an editor
 * touches one without the other, this fails in CI. Pure (no DB): it parses the
 * markdown off disk and compares it to the in-memory table.
 *
 * Parse contract: every sub-rule is a single line of the form
 *   **<major>.<minor> <Title>.** <body>
 * Group titles + machine codes are seed-authored (not present in the prose), so
 * they are checked for internal consistency, not against the markdown.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GOLDEN_RULES } from './goldenRules';

interface FlatSubRule {
  number: string;
  title: string;
  description: string;
}

function parseCodeOfConduct(): FlatSubRule[] {
  const md = readFileSync(
    resolve(__dirname, '../../CODE_OF_CONDUCT.md'),
    'utf8'
  );
  const re = /^\*\*(\d+\.\d+) (.+?)\.\*\* (.+)$/gm;
  const out: FlatSubRule[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ number: m[1], title: m[2], description: m[3] });
  }
  return out;
}

function flattenSeed(): FlatSubRule[] {
  const out: FlatSubRule[] = [];
  GOLDEN_RULES.forEach((rule, i) => {
    rule.subRules.forEach((sub, j) => {
      out.push({
        number: `${i + 1}.${j + 1}`,
        title: sub.title,
        description: sub.description
      });
    });
  });
  return out;
}

describe('Golden Rules ↔ CODE_OF_CONDUCT.md drift-guard', () => {
  const prose = parseCodeOfConduct();
  const seed = flattenSeed();

  it('parses the six numbered groups out of the prose', () => {
    // 3 + 3 + 5 + 8 + 3 + 2 = 24 sub-rules across 6 groups.
    expect(prose.length).toBe(24);
    expect(seed.length).toBe(prose.length);
  });

  it('keeps the seed table byte-identical to the canonical prose', () => {
    // number + title + verbatim body, in order — catches any silent drift.
    expect(seed).toEqual(prose);
  });

  it('has exactly six immutable Golden Rules', () => {
    expect(GOLDEN_RULES.length).toBe(6);
  });

  it('uses unique rule codes and unique sub-rule codes within each rule', () => {
    const ruleCodes = GOLDEN_RULES.map((r) => r.code);
    expect(new Set(ruleCodes).size).toBe(ruleCodes.length);
    for (const rule of GOLDEN_RULES) {
      const subCodes = rule.subRules.map((s) => s.code);
      expect(new Set(subCodes).size).toBe(subCodes.length);
    }
  });
});
