# PRD-09 — Golden-Rules Surfacing & Variable Resolution

**Status:** Draft · **Owner:** @obrien-k · **Extends:** [PRD-05 Rules & Governance](05-rules-and-governance.md)
**Decisions:** [ADR-0020 rules-tree variable resolution](../adr/0020-rules-tree-variable-resolution.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · PRD-07 Donations · PRD-08 Collages & Cover Art · **PRD-09 Golden-Rules Surfacing**

> Surfaces the six Golden Rules to **end users**, not just developers, from a single authored source. PRD-05 defines the rule _model_; #123 shipped the substrate (`Rule`/`SubRule`, `ruleImpact()`, `GET /api/rules/tree`); this PRD seeds that tree from the canonical prose and resolves its placeholders so the rules render in-app with no third hand-maintained copy.

## Why

The Golden Rules have a canonical prose home (`CODE_OF_CONDUCT.md`) and a data substrate (the rule tree), but nothing connected them — the tree was empty and the prose's `${...}` placeholders and links resolved nowhere. Re-authoring the rules in the UI would have created a third copy that drifts. Instead: the six rules are **seeded** from the prose into the tree, and a read-time **variable map** resolves the placeholders, so the existing API-driven `RulesPage` renders them for free. One authored source (`CODE_OF_CONDUCT.md`), one rendered surface.

## The six rules are immutable canon

The six Golden Rules are non-negotiable and baked into the software — the seeded **root** of the composable rule tree (PRD-05). A per-Community rule may only ever be a **subset or extension** of these six; it can never weaken or remove one. This is the "path of guidance for communities to follow": the root is fixed, Communities compose on top.

## Single authored source + drift-guard

`CODE_OF_CONDUCT.md` is the canonical prose. `src/modules/goldenRules.ts` holds `GOLDEN_RULES` — a structured mirror (6 `Rule` groups, each `x.y` entry a `SubRule`, bodies copied verbatim) — and the idempotent `seedGoldenRules()` (a no-op once any `Rule` rows exist; wired through `prisma/seed.ts` and the install route, like `seedForums`). Group titles and machine `code`s live only in the seed (the prose numbers its groups but does not name them), so a blind markdown parser was rejected. Instead `goldenRules.spec.ts` parses the prose and asserts every sub-rule's number, title, and verbatim body match the seed — drift fails CI. CRS micro-impact weights seed at the schema default `0` (magnitudes are PRD-05 TBD).

## Variable resolution (the `${...}` tokens)

The prose carries `${...}` tokens and tokenized links that resolve nowhere on their own. `GET /api/rules/tree` returns the **verbatim** tree (tokens intact) **plus** a resolved `variables` map; the UI does the mechanical substitution and owns presentation (e.g. renders `${irc}` as the real nav link, `${vpns_article}` as an anchor to the resolved URL). The API single-sources the values (`src/modules/siteVariables.ts` → `resolveSiteVariables()`); no value is duplicated cross-repo. See [ADR-0020](../adr/0020-rules-tree-variable-resolution.md) for why values-map-over-fully-resolved-text and over UI-owned-values.

### Token registry

| Token                                                                                                                | Class     | Resolves to                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `${site_name}`                                                                                                       | text      | `config.site.name` (`STELLAR_SITE_NAME`, default `Stellar`)                          |
| `${disabled_channel}`                                                                                                | text      | `config.site.disabledChannel` (`STELLAR_DISABLED_CHANNEL`, default `#disabled`)      |
| `${irc}`                                                                                                             | route     | `config.site.ircUrl` (`STELLAR_IRC_URL`, default `/irc`); UI renders as the nav link |
| `${staffpm}`                                                                                                         | route     | `config.site.staffPmPath` (`STELLAR_STAFFPM_PATH`, default `/inbox/staff`)           |
| `${public_kb}`                                                                                                       | route     | the **Stellar Public KB** root (`STELLAR_PUBLIC_KB_BASE`)                            |
| `${interview_article}` `${vpns_article}` `${ips_article}` `${autofp_article}` `${bugs_article}` `${exploit_article}` | Public KB | `${public_kb}/<slug>` — net-new public guidance articles                             |
| `${invite_article}` `${classes_article}` `${requests_article}` `${interfaces_article}`                               | internal  | internal wiki routes (`/wiki/<slug>`) for app-feature references                     |
| `${bugs_forum}`                                                                                                      | internal  | the seeded **Bugs** forum (id-based; resolved by name lookup)                        |

**Text** tokens substitute in place as-is; **route/URL** tokens are wrapped by the UI in its own link presentation. Public-guidance articles live in the **Stellar Public KB** — a public-facing wiki peer to IRC — and are authored there (tracked separately). App-feature references resolve to internal wiki routes. There are **no external third-party links** in the rules prose; the only literal external URL is the project's own GitHub repo (rule 5.2's API link).

## Concept → code

| Concept                  | Lives in                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| Canonical prose          | `CODE_OF_CONDUCT.md`                                                       |
| Seed table + seeder      | `src/modules/goldenRules.ts` (`GOLDEN_RULES`, `seedGoldenRules()`)         |
| Drift-guard              | `src/modules/goldenRules.spec.ts`                                          |
| Variable resolution      | `src/modules/siteVariables.ts`, `src/modules/config.ts` (`site` block)     |
| Read endpoint            | `GET /api/rules/tree` (`src/routes/api/rules.ts`) — `{ rules, variables }` |
| Substrate (shipped #123) | `Rule`/`SubRule` models, `src/modules/ruleImpact.ts`                       |

## Open questions

- CRS micro-impact magnitudes per node — PRD-05 TBD; rows seed at `0`.
- Stellar Public KB article authoring (`interview`, `vpns`, `ips`, `autofp`, `security-disclosure`, `exploits`) — tracked issue.
- Internal feature-doc wiki stubs (`invite`, `classes`, `requests`, `interfaces`) — author where missing.
- stellar-ui substitution: `RulesPage`/`rulesApi` consume the `variables` map (downstream PR).
- `${bugs_forum}` route shape (`/forums/:id`) — confirm against the stellar-ui forum route.
