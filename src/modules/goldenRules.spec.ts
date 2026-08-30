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
import type { PrismaClient } from '@prisma/client';
import {
  GOLDEN_RULES,
  GOLDEN_RULE_CODE_PREFIX,
  seedGoldenRules
} from './goldenRules';

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

  it('keeps every rule code under the namespace its seed guard counts', () => {
    // seedGoldenRules guards on `code startsWith GOLDEN_RULE_CODE_PREFIX`. A
    // rule code outside that namespace would be invisible to its own guard, so
    // the seed would re-run and collide on the unique code.
    for (const rule of GOLDEN_RULES) {
      expect(rule.code.startsWith(GOLDEN_RULE_CODE_PREFIX)).toBe(true);
    }
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

/**
 * The seed guard itself (#388). The fake client below stores rows and honours
 * the `startsWith` filter, so a table-wide `rule.count()` genuinely fails these
 * rather than merely looking different — which is the point: the old guard was
 * a no-op once *any* Rule row existed, not once the golden rows existed.
 */
function fakeRuleClient(existingCodes: string[] = []) {
  const rows: { code: string }[] = existingCodes.map((code) => ({ code }));
  const create = jest.fn(async ({ data }: { data: { code: string } }) => {
    rows.push({ code: data.code });
    return data;
  });
  const count = jest.fn(
    async (args?: { where?: { code?: { startsWith?: string } } }) => {
      const prefix = args?.where?.code?.startsWith;
      if (prefix === undefined) return rows.length;
      return rows.filter((r) => r.code.startsWith(prefix)).length;
    }
  );
  const client = { rule: { count, create } } as unknown as PrismaClient;
  return { rows, create, count, client };
}

describe('seedGoldenRules', () => {
  it('seeds the canon on an empty rules table', async () => {
    const { create, rows, client } = fakeRuleClient();
    await seedGoldenRules(client);
    expect(create).toHaveBeenCalledTimes(GOLDEN_RULES.length);
    expect(rows.map((r) => r.code).sort()).toEqual(
      GOLDEN_RULES.map((r) => r.code).sort()
    );
  });

  it('still seeds the canon when an unrelated ruleset holds Rule rows', async () => {
    // The #388 regression: PRD-05 specs irc.conduct and interview.conduct, and
    // either one seeding first used to suppress the Golden Rules entirely.
    const { create, rows, client } = fakeRuleClient([
      'irc.conduct',
      'interview.conduct'
    ]);
    await seedGoldenRules(client);
    expect(create).toHaveBeenCalledTimes(GOLDEN_RULES.length);
    for (const rule of GOLDEN_RULES) {
      expect(rows.map((r) => r.code)).toContain(rule.code);
    }
  });

  it('stays a no-op once the golden rules are already seeded', async () => {
    const { create, client } = fakeRuleClient();
    await seedGoldenRules(client);
    await seedGoldenRules(client);
    expect(create).toHaveBeenCalledTimes(GOLDEN_RULES.length);
  });
});
