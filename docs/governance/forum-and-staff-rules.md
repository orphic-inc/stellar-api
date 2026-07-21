# Governance sub-rulesets — ForumRules, StaffRules, IRCRules, InterviewRules

> PRD-05 descent target #3 ([#126](https://github.com/orphic-inc/stellar-api/issues/126)). Two halves in one document, and the distinction matters when reading it: **ForumRules and StaffRules are documented as built** against the code on `main` (reference — if the code and this text disagree, the code wins), while **IRCRules and InterviewRules are specs for rulesets that do not exist yet** (nothing below them is implemented). Each section states which it is. Parent: [PRD-05 Rules & Governance](../prd/05-rules-and-governance.md). Substrate shipped in [#123](https://github.com/orphic-inc/stellar-api/issues/123) (Rule/SubRule + `ruleImpact()`) and [#124](https://github.com/orphic-inc/stellar-api/issues/124) (standing).

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

Staff conduct is governed canonically by the **`respect-staff-decisions` sub-rule under Golden Rule 4, Conduct** ("staff are volunteers; their interpretation of the rules is final; raise disputes privately") — scored by `ruleImpact()` like any other node, with the sub-rule weight composing on top of `golden.conduct`'s. Earlier drafts carried "Respect Staff" as a standalone 7th rule; it folded into Conduct (PRD-05), and the canon is 6 rules. `golden.conduct` also carries `no-impersonate-staff` and `no-backseat-moderate`, which govern members' conduct _toward_ staff rather than staff's own.

### Staff structure & enforcement (wired)

- **`StaffGroup`** (`name` unique, `sortOrder`) groups `UserRank`s — the organizational unit for staff.
- **`UserRank`** (`level`, `permissions`) is the rank/permission carrier; staff powers are granted as granular permissions, never as a named "isStaff" role (ADR-0001). Staff conduct rules are enforced through the same permission gates as everything else.
- **Staff workflow surfaces** that operate under these rules: `staffInbox.ts` (support tickets), `reports.ts` (report claim/resolve), `staffPm.ts` (staff-to-staff messaging).

### The "+50 CRS / week-served" signal — planned, NOT built

PRD-05 lists StaffRules as carrying a "+50 CRS/week-served signal (cross-ref PRD-01)." **This is not implemented on `main`.** The CRS dimension registry (`src/modules/reputation.ts`) has no staff-tenure dimension — the built dimensions are longevity, ratio, friends, and IRC. The week-served reward is a PRD-01/PRD-05 concept awaiting a scoring decision (magnitude is HITL, like every other CRS magnitude), and should be tracked as a CRS-dimension follow-up rather than assumed present.

## Seeding the net-new rulesets (read before writing either seeder)

Both specs below add top-level `Rule` nodes, and there is a trap in the way. `seedGoldenRules()` (`src/modules/goldenRules.ts`) guards on `await client.rule.count()` — it is a no-op once **any** `Rule` row exists, not once the _golden_ rules exist. A separate `seedIrcRules()` / `seedInterviewRules()` that runs before it on a fresh database would silently suppress the entire Golden Rules seed, and the drift-guard spec would not catch it (that spec compares the in-code table to `CODE_OF_CONDUCT.md`, never the database).

So a new ruleset seeder must do one of two things, and the choice should be made once rather than per-seeder:

- **Narrow the existing guard** to `client.rule.count({ where: { code: { startsWith: 'golden.' } } })`, leaving each ruleset to guard its own namespace. Preferred — it makes the guard mean what its name implies.
- **Compose into `seedAll.ts`** with a single table-wide guard covering every ruleset at once, so ordering cannot matter.

Neither ruleset may add sub-rules to a `golden.*` node. Those nodes mirror `CODE_OF_CONDUCT.md` verbatim under the drift-guard, so an extra child breaks the mirror. IRC and Interview conduct therefore land as **sibling top-level rules that extend the canon**, exactly as PRD-05's composable model intends, and deliberately avoid restating what a golden rule already covers.

## A note on the weights in both specs

Every `Rule`/`SubRule` weight column defaults to `0`, all six golden rules seed at `0`, and PRD-05's open questions flag every CRS magnitude as TBD. Assigning concrete numbers to IRC and Interview nodes would make them the only weighted rules on the site and would create a second, contradictory source of truth for magnitudes.

These specs therefore decide **relative ordering** — which sub-rules must outrank which, and by roughly what factor — and leave absolute values to seed at `0` alongside the golden rules. When PRD-05's magnitude question is settled site-wide, the ordering here is already fixed and the numbers drop into it. Ordering is expressed as tiers: **major** (strikes at the integrity of the network or the gate), **moderate** (degrades the space for others), **minor** (friction, usually first-offense-warnable).

## IRCRules (spec — not built)

Conduct on the IRC network. The IRC _feature_ is [PRD-02](../prd/02-irc-and-announce.md); the rules are here. The network itself is korin.pink's infrastructure ([ADR-0013](../adr/0013-korin-pink-irc-integration.md)) — stellar-api owns the rule prose and the CRS weights, and owns neither the channels nor the moderation tooling.

### Enforcement seam (v1: prose-only)

**Decided: there is no automated korin → stellar violation feed in v1.** An IRC violation reaches CRS the same way any other violation does — a staff member files it against the account through the existing warning/report path, and `ruleImpact()` scores it against the actor's standing tier. korin.pink's inbound service-key surface (`requireServiceKey`) stays read/announce-shaped; it does not gain authority to penalize accounts.

This is a deliberate trade. Automating it would mean a new cross-repo contract, an ADR, korin-side work, and — the real cost — granting an external service the power to move a member's reputation without a human in the loop. The manual path reuses machinery that already exists and keeps a person accountable for every penalty. Revisit only if IRC moderation volume makes the manual path the bottleneck, and revisit it as its own ADR.

The load-bearing prerequisite is attribution: penalizing an account for an IRC act requires knowing which account a nick belongs to. That is the **verified nick link** ([ADR-0015](../adr/0015-verified-irc-nick-link.md), `src/modules/ircNick.ts`) — a challenge/nonce proof-of-control promoting a claim to a verified nick. An unverified nick cannot be scored, only channel-moderated. This is why `verified-nick` below is a major-tier rule rather than housekeeping: it is the precondition for every other rule in the set having teeth.

### Proposed node: `irc.conduct`

| Sub-rule              | Tier     | Governs                                                                                                                                                  |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified-nick`       | major    | Link and keep verified the nick you use on the network; do not act under an unverified nick to obscure attribution, and do not use another member's nick |
| `no-irc-ban-evasion`  | major    | A channel or network ban is a site sanction; returning under a new nick or host escalates rather than resets it                                          |
| `no-announce-abuse`   | major    | Do not scrape, relay, or republish the announce feed, and do not automate against it beyond what the API permits                                         |
| `no-channel-spam`     | moderate | No flooding, repeat advertising, mass-highlight, or CTCP/DCC spam                                                                                        |
| `respect-channel-ops` | moderate | Channel operators carry staff authority in-channel; disputes go to `${staffpm}`, not the channel                                                         |
| `on-topic-channels`   | minor    | Keep channels to their stated purpose; `${disabled_channel}` is for its stated purpose                                                                   |

Three of these have a golden-rule shadow and are scoped to avoid duplicating it: `no-announce-abuse` extends `golden.access-automation`'s `no-autosnatch` and `no-automated-abuse` onto the IRC transport specifically; `respect-channel-ops` extends `golden.conduct`'s `respect-staff-decisions` to operators; and sharing an IRC key is already `golden.contribution-integrity` → `protect-credentials` and is deliberately **not** restated here. General civility, impersonation, and harassment on IRC are `golden.conduct` and likewise stay there — IRCRules cover what is specific to the network, not a second copy of the canon.

### What this spec does not decide

Channel list and per-channel rules (tracked separately; see the korin channel-list hold noted in PRD-02), whether verified-nick becomes a _precondition_ for network access rather than a rule violated after the fact, and the retention/audit shape of IRC moderation logs.

## InterviewRules (spec — not built)

Recruitment and interview conduct. **There is no interview substrate in this repository** — the only `Interview` identifier in the schema is a `ReleaseCategory` enum value and is unrelated; `Applicant` and `Thread` are stub models with no routes. The live signals are `siteVariables.ts`'s `interview_article` token and the `golden.accounts` prose directing prospective members to the **IRC Interview**. The interview is an IRC-side flow, which makes the seam below the whole design.

### Governs both sides, asymmetrically

**Decided: InterviewRules govern the interviewee and the interviewer, with different enforcement paths**, because the two parties are not symmetric. An applicant has no account, so CRS cannot touch them; an interviewer is staff, holds the power in the interaction, and is fully scoreable. Governing only the applicant would leave the powerful side of a gatekeeping interaction unwritten.

| Side        | Sub-rule                    | Tier     | Governs                                                                                                      |
| ----------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Applicant   | `honest-answers`            | major    | Answer truthfully; do not misrepresent identity, history, or prior accounts                                  |
| Applicant   | `own-interview`             | major    | Sit your own interview; no proxying or coaching-through, and no second interview against an existing account |
| Applicant   | `no-shared-questions`       | major    | Do not solicit, collect, share, or publish interview questions or answers                                    |
| Applicant   | `interview-civility`        | moderate | Civility toward interviewers, during and after; no retaliation for a failed interview                        |
| Interviewer | `consistent-standard`       | major    | Apply the published standard uniformly; no ad-hoc bars, no bars not in the standard                          |
| Interviewer | `no-personal-gain`          | major    | No trading, selling, or favoring passes; no quid pro quo of any kind                                         |
| Interviewer | `interview-confidentiality` | major    | Applicant details stay in staff channels; nothing disclosed publicly or to other applicants                  |
| Interviewer | `record-the-outcome`        | moderate | Log the pass/fail so the decision is auditable after the fact                                                |

### The asymmetry, concretely

**Applicant-side violations do not score CRS.** There is no account to score. They gate entry — the interview fails, optionally with a cooldown before re-applying. Enforcement happens off-platform, by the interviewer, in the IRC flow. If an applicant is admitted and the violation surfaces afterward, it converts: `honest-answers` and `own-interview` breaches are then `golden.accounts` matters against the live account, which is where multi-account and misrepresentation already live.

**Interviewer-side violations score normally** through `ruleImpact()`, and should carry **heavier weights than the member-facing equivalent of the same act**. An interviewer trading passes is the gate itself being sold, not one member misbehaving; the power asymmetry is the reason the tier is set at major across the board. These sub-rules are an extension of StaffRules and inherit the staff enforcement path documented above.

### Open, needs product decision before implementation

Whether the interview flow is ever modeled in stellar-api at all (today it is entirely korin.pink's, and these rules may be prose the API only stores and serves), whether `Applicant`/`Thread` get promoted from stubs to back an in-app application queue, whether a failed interview carries a cooldown and how long, and whether interviewer decisions need a second-reviewer path for appeals.

## Built vs. stub — summary

| Surface                               | Status              | Backed by                                                         |
| ------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| Rule/SubRule tree + weights           | **Built** (#123)    | `Rule`, `SubRule`, `GET /api/rules/tree`                          |
| `ruleImpact()` scorer (structure)     | **Built** (#123)    | `src/modules/ruleImpact.ts` — magnitudes TBD                      |
| Standing tier feeding the scorer      | **Built** (#124)    | `src/modules/standing.ts`                                         |
| `RulesPage` prose + CRUD              | **Built**           | `src/routes/api/rules.ts`, `rules_manage`                         |
| Forum class-gates (read/write/create) | **Built**           | `Forum.minClass*`, `canAccessForumLevel`                          |
| Permission enforcement                | **Built**           | ADR-0001 `requirePermission`/`hasPermission`                      |
| Staff structure                       | **Built**           | `StaffGroup`, `UserRank`, staff surfaces                          |
| `ForumSpecificRule` per-node overlays | **Stub**            | model only, no code                                               |
| Staff "+50 CRS/week-served"           | **Planned**         | not in `reputation.ts` (CRS-dimension follow-up)                  |
| CRS magnitudes (all rule weights)     | **TBD**             | placeholders in `ruleImpact.ts` + weight columns default 0        |
| `irc.conduct` ruleset                 | **Spec'd, unbuilt** | this doc — no seeder, no rows, no route                           |
| `interview.conduct` ruleset           | **Spec'd, unbuilt** | this doc — no substrate at all; flow is korin.pink's              |
| Verified nick (IRC attribution)       | **Built**           | `src/modules/ircNick.ts`, ADR-0015 — prerequisite for IRC scoring |
