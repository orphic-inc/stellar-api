# ForumRules & StaffRules — as built

> PRD-05 descent target #3, documentation half ([#126](https://github.com/orphic-inc/stellar-api/issues/126)). This documents the **already-built** ForumRules and StaffRules against the code on `main` — it is reference, not a spec. The net-new IRCRules and InterviewRules sub-rulesets are the HITL half of #126 and are **not** covered here (they need product decisions on content + CRS weights before they can be spec'd). Parent: [PRD-05 Rules & Governance](../prd/05-rules-and-governance.md). Substrate shipped in [#123](https://github.com/orphic-inc/stellar-api/issues/123) (Rule/SubRule + `ruleImpact()`) and [#124](https://github.com/orphic-inc/stellar-api/issues/124) (standing).

## What "ForumRules" and "StaffRules" actually are

Neither is a single model. Both are **views over shared governance substrate**: the composable `Rule`/`SubRule` tree and its pure CRS scorer, the `RulesPage` prose store, and the granular-permission enforcement layer (ADR-0001). ForumRules additionally lean on the forum's built **class-gate** access system; StaffRules additionally lean on `StaffGroup`/`UserRank`. This doc maps each to the code that backs it and flags, honestly, what is wired versus what is still a stub.

## Shared substrate (backs both)

### The Rule/SubRule tree + `ruleImpact()`

The data-driven rule tree (`prisma/schema.prisma` → `Rule`, `SubRule`) is the governance backbone. Each node carries its own CRS micro-impact so rules are data, not hardcoded branches.

- **`Rule`** — `code` (machine-stable, unique, e.g. `golden.accounts`), `title`, `description`, `complianceWeight` (CRS reward when adhered to, ≥ 0), `violationWeight` (CRS penalty magnitude when breached, ≥ 0), `sortOrder`. Has many `SubRule`.
- **`SubRule`** — child of a `Rule` (`onDelete: Cascade`, `@@unique([ruleId, code])`); same weight pair; its weight composes **additively** on top of the parent's.
- **Exposure** — `GET /api/rules/tree` (`src/routes/api/rules.ts`) returns the ordered tree with weights; it is the read-only substrate `ruleImpact()` consumes. Login-gated only (rules are site-wide and visible to every member).

The pure scorer is `ruleImpact(event)` (`src/modules/ruleImpact.ts`). Given an `outcome` (`compliance` | `violation`), the node weights, and the actor's `Standing` tier, it returns a signed CRS delta:

- **Compliance** scales **up** with good standing — `pristine ×10, clean ×3, neutral ×1, poor ×0.5, hammer ×0.25`. Pristine long-term standing is the strongest positive; the long-term poor barely earn back.
- **Violation** scales **up** with bad standing — `pristine/clean/neutral ×1, poor ×3, hammer ×10`. A clean record takes the face-value hit; the repeat offender takes the "mighty hammer."
- Sub-rule weight is added to the parent's before the multiplier is applied.

> **CRS weights as implemented:** every `Rule`/`SubRule` weight column defaults to `0`, and the standing multipliers above are **placeholders**. PRD-05's open questions flag the ×10 pristine reward, the hammer curve, and per-node micro-impacts as **TBD** — the _structure_ is settled, the _magnitudes_ are not. The code comment is explicit: change the tables in `ruleImpact.ts` and the spec together.

The `Standing` tier itself (`pristine | clean | neutral | poor | hammer`) is computed by `computeStanding()` (`src/modules/standing.ts`, #124) from active `UserWarning` rows + ban state, surfaced as `PublicProfile.standing`. Thresholds are ADR-0004 placeholders.

### The `RulesPage` prose store

Human-readable rule prose lives in `RulesPage` (`slug` unique, `title`, `body`, `isMain`, `sortOrder`, `author`). One row may be the main page (`isMain`, enforced single-main in a transaction at the API layer). CRUD is in `src/routes/api/rules.ts`, gated by the `rules_manage` permission, audited (`rules.create` / `rules.edit` / `rules.delete`), with `body` run through `sanitizeHtml`. The main page cannot be deleted; slugs are immutable after creation.

### Enforcement layer (ADR-0001)

There are **no named role checks**. Every rule gate names an explicit permission via `requirePermission` / `hasPermission` ([ADR-0001](../adr/0001-granular-permission-checks.md)). `rules_manage` (`src/lib/rankPermissions.ts`) is the permission that governs rule-content management. This is the substrate both ForumRules and StaffRules enforce through.

## ForumRules (built)

Forum governance is **two layers**: access control (who may read/write/create where) and rule prose/weights (what the rules are).

### Access control — the class-gate system (wired)

The `Forum` model carries three integer gates — `minClassRead`, `minClassWrite`, `minClassCreate` (default `0`) — plus an `isTrash` flag. Enforcement is `canAccessForumLevel(user, forumId, minClass)` (`src/lib/userRankAccess.ts`), called across the forum routes (`src/routes/api/forum/forumTopic.ts`, `forumLastReadTopic.ts`, and `src/modules/forum.ts`). A member's `userRankLevel` (carried on `req.user` from the auth middleware) is compared against the forum's required class for the action. This is the governance that is **actually enforced** on the forum today.

### Rule prose/weights (shared substrate)

Forum rule prose lives in `RulesPage`; forum-relevant `Rule`/`SubRule` nodes (e.g. forum-conduct rules) carry the CRS weights and are scored by `ruleImpact()` as above. There is no forum-specific scorer — ForumRules reuse the shared tree.

### `ForumSpecificRule` — stub, not wired

The schema defines `ForumSpecificRule` (`targetType` → `ForumRuleTarget` enum `Forum | Thread | Topic`, plus nullable `forum` / `thread` / `forumTopic` relations) for attaching a rule to a specific forum, thread, or topic. **It has zero code usage** — no routes, no module reads or writes it. It is a planned model (CLAUDE.md "Stub models"), the intended home for per-forum/topic/thread rule overlays once that feature is built. Documented here so the gap is explicit: today, forum-level governance is the class-gate system + the shared rule tree, **not** per-node `ForumSpecificRule` overlays.

## StaffRules (built)

Staff conduct is governed canonically by **Golden Rule #7, "Respect Staff"** ("staff are volunteers; their interpretation of the rules is final; raise disputes privately") — a site-wide `Rule` node like any other, scored by `ruleImpact()`.

### Staff structure & enforcement (wired)

- **`StaffGroup`** (`name` unique, `sortOrder`) groups `UserRank`s — the organizational unit for staff.
- **`UserRank`** (`level`, `permissions`) is the rank/permission carrier; staff powers are granted as granular permissions, never as a named "isStaff" role (ADR-0001). Staff conduct rules are enforced through the same permission gates as everything else.
- **Staff workflow surfaces** that operate under these rules: `staffInbox.ts` (support tickets), `reports.ts` (report claim/resolve), `staffPm.ts` (staff-to-staff messaging).

### The "+50 CRS / week-served" signal — planned, NOT built

PRD-05 lists StaffRules as carrying a "+50 CRS/week-served signal (cross-ref PRD-01)." **This is not implemented on `main`.** The CRS dimension registry (`src/modules/reputation.ts`) has no staff-tenure dimension — the built dimensions are longevity, ratio, friends, and IRC. The week-served reward is a PRD-01/PRD-05 concept awaiting a scoring decision (magnitude is HITL, like every other CRS magnitude), and should be tracked as a CRS-dimension follow-up rather than assumed present.

## Built vs. stub — summary

| Surface                               | Status             | Backed by                                                  |
| ------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Rule/SubRule tree + weights           | **Built** (#123)   | `Rule`, `SubRule`, `GET /api/rules/tree`                   |
| `ruleImpact()` scorer (structure)     | **Built** (#123)   | `src/modules/ruleImpact.ts` — magnitudes TBD               |
| Standing tier feeding the scorer      | **Built** (#124)   | `src/modules/standing.ts`                                  |
| `RulesPage` prose + CRUD              | **Built**          | `src/routes/api/rules.ts`, `rules_manage`                  |
| Forum class-gates (read/write/create) | **Built**          | `Forum.minClass*`, `canAccessForumLevel`                   |
| Permission enforcement                | **Built**          | ADR-0001 `requirePermission`/`hasPermission`               |
| Staff structure                       | **Built**          | `StaffGroup`, `UserRank`, staff surfaces                   |
| `ForumSpecificRule` per-node overlays | **Stub**           | model only, no code                                        |
| Staff "+50 CRS/week-served"           | **Planned**        | not in `reputation.ts` (CRS-dimension follow-up)           |
| CRS magnitudes (all rule weights)     | **TBD**            | placeholders in `ruleImpact.ts` + weight columns default 0 |
| IRCRules / InterviewRules             | **Net-new (HITL)** | the deferred spec half of #126                             |
