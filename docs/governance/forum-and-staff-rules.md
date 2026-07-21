# Governance sub-rulesets — where rules live and what enforces them

> PRD-05 descent target #3 ([#126](https://github.com/orphic-inc/stellar-api/issues/126)). Reference for the code on `main` — if this text and the code disagree, the code wins. Parent: [PRD-05 Rules & Governance](../prd/05-rules-and-governance.md).
>
> **Rewritten 2026-07-21.** An earlier version framed the sub-rulesets as CRS-weighted `Rule`/`SubRule` tree nodes. That was wrong twice over: the sub-rulesets are prose pages, and CRS is deferred until post-v1. The built-vs-stub map for forum and staff enforcement survives from that version; the scoring framing does not.

## The model in one paragraph

There are exactly two kinds of rule content. **The six Golden Rules** are the canon — seeded `Rule`/`SubRule` rows mirroring [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) verbatim under a CI drift-guard, immutable in substance, served by `GET /api/rules/tree`. **Everything else is a wiki page** the canon links to with a `${...}` token. There is no third mechanism, and a sub-ruleset is not a tree node.

## Where each ruleset lives

The split is decided by **earliest-needed audience**: if someone without an account may need to read it, it is public. That is not a stylistic preference — registration is invite-only, access runs through an Interview held on IRC, and every in-app wiki route sits behind `requireAuth` (`src/routes/api/wiki.ts`). Onboarding prose in the in-app wiki would lock applicants out of the front door.

| Ruleset        | Home                             | Token                    | Owner       |
| -------------- | -------------------------------- | ------------------------ | ----------- |
| GoldenRules    | seeded `Rule`/`SubRule` tree     | —                        | stellar-api |
| ForumRules     | in-app wiki, `/wiki/forum-rules` | `${forum_rules_article}` | stellar-api |
| StaffRules     | in-app wiki, `/wiki/staff-rules` | `${staff_rules_article}` | stellar-api |
| IRCRules       | public wiki, korin.pink          | `${irc_rules_article}`   | korin-pink  |
| InterviewRules | public wiki, korin.pink          | `${interview_article}`   | korin-pink  |
| CommunityRules | per-Community, unbuilt           | —                        | —           |

IRC content lives in korin-pink because IRC is korin's system and applicants must read it pre-account. Keeping a copy here would be a cross-repo drift pair with no guard — which is exactly what `prisma/scripts/seed-wiki-irc-community.ts` had become before it was deleted (its pages already existed at `packages/web/src/content/docs/wiki/irc/`).

## Seeding

`seedWikiFixtures()` (`src/modules/wikiFixtures.ts`) seeds the in-app pages, owned by the reserved System user, with prose authored as real markdown under `prisma/seed-wiki/` — the same shape `stylesheetFixtures` uses for CSS, so it reviews as prose in a diff.

It seeds eleven pages in three groups:

- the two **sub-ruleset** pages (`forum-rules`, `staff-rules`) — normative, rules in their own right;
- the four **feature explainers** the canon has always cited and nothing ever created — `invite`, `classes`, `requests`, `interfaces`. Those four were live dead links in every install;
- the five **policy guidance** pages behind Golden Rules 5 and 6 — `vpns`, `ips`, `autosnatch`, `security-disclosure`, `exploits` ([#215](https://github.com/orphic-inc/stellar-api/issues/215)).

That third group was originally filed as public-KB content on korin.pink. It is in-app because the earliest-needed-audience test puts it there: every behaviour those pages govern — browsing through a proxy, snatching freepass, probing the live site — requires an account, so nothing is lost by gating them. Only the Interview and IRC pages clear the pre-account bar.

`security-disclosure` and the repo's `SECURITY.md` are split by audience rather than mirrored: the wiki page is the member reporting route, `SECURITY.md` carries the coordinated-disclosure terms for researchers working from the repository. They cross-reference and deliberately do not restate each other, so there is no drift pair to guard.

Two gotchas worth knowing before touching this:

- **Wiki bodies are served verbatim.** `${...}` substitution happens only for `GET /api/rules/tree` (ADR-0020). A token written into a wiki page renders literally. `wikiFixtures.spec.ts` asserts fixture bodies carry none.
- **Create-if-absent per slug, not a table-wide guard.** Pages are editable in-app once seeded, so re-running must not clobber operator edits — while a new fixture in a later release still lands on an existing install. The table-wide shape is the trap [#388](https://github.com/orphic-inc/stellar-api/issues/388) records against `seedGoldenRules`, where one pre-existing row suppresses the entire set.

`wikiFixtures.spec.ts` guards the link contract: every internal `/wiki/...` token in `resolveSiteVariables()` must have a fixture. That is the test that stops the dead-link bug recurring.

## ForumRules — what actually enforces them

Forum governance is two layers: access control, which is wired, and prose, which is the wiki page above.

### Class gates (wired)

`Forum` carries three independent integer thresholds — `minClassRead`, `minClassWrite`, `minClassCreate` (default `0`) — plus an `isTrash` flag. Enforcement is `canAccessForumLevel(user, forumId, minClass)` (`src/lib/userRankAccess.ts`), called from `src/routes/api/forum/forumTopic.ts`, `forumLastReadTopic.ts`, and `src/modules/forum.ts`. The member's `userRankLevel`, carried on `req.user` by the auth middleware, is compared against the forum's requirement for the action. A forum above your read class is not listed rather than erroring.

This is the governance actually enforced on the forum today.

### `ForumSpecificRule` — stub, not wired

The schema defines `ForumSpecificRule` (`targetType` → `ForumRuleTarget` enum `Forum | Thread | Topic`, plus nullable `forum` / `thread` / `forumTopic` relations) for attaching a rule to a specific forum, thread, or topic. **Zero code usage** — no routes, no module reads or writes it. It is the intended home for per-node rule overlays once that feature is built. Today, forum governance is class gates plus the shared canon, not per-node overlays.

## StaffRules — what actually enforces them

Staff conduct is canonically the **`respect-staff-decisions` sub-rule under Golden Rule 4, Conduct**, which now also links out to the staff rules page. Earlier drafts carried "Respect Staff" as a standalone 7th rule; it folded into Conduct, and the canon is six. `golden.conduct` also carries `no-impersonate-staff` and `no-backseat-moderate`, which govern members' conduct _toward_ staff rather than staff's own.

- **`StaffGroup`** (`name` unique, `sortOrder`) groups `UserRank`s — organisational only; the group carries no power.
- **`UserRank`** (`level`, `permissions`) carries it. Staff powers are granular permissions, never a named `isStaff` role ([ADR-0001](../adr/0001-granular-permission-checks.md)).
- **Surfaces operating under these rules:** `staffInbox.ts` (tickets), `reports.ts` (claim/resolve), `staffPm.ts`.

## Enforcement substrate (both)

There are **no named role checks**. Every gate names an explicit permission via `requirePermission` / `hasPermission` (ADR-0001). `rules_manage` (`src/lib/rankPermissions.ts`) governs rule-content management; wiki pages use `minEditLevel` plus the wiki route's own permission checks.

The `RulesPage` model is a separate, untouched surface: operator-authored supplementary prose, admin CRUD in `src/routes/api/rules.ts`, rendered by the UI beneath the canon. It is not where sub-rulesets live.

## CRS — deferred, and not partially built

CRS scoring of rule outcomes is **deferred until post-v1**. State on `main`, stated plainly so nobody builds on a mechanism that isn't there:

- `ruleImpact()` (`src/modules/ruleImpact.ts`) is a pure, tested function with **zero production callers**. No rule violation has ever moved CRS.
- `warnUser()` (`src/modules/user.ts`) takes a free-text `reason` and carries **no reference to any rule node**. Warnings and rules are unconnected.
- Every `Rule`/`SubRule` weight column defaults to `0`, and all six Golden Rules seed at `0`.
- `computeStanding()` **is** wired, on the profile read path only (`PublicProfile.standing`).

Wiring these is post-v1 work and needs a warning→rule linkage that does not exist yet.

## Built vs. stub — summary

| Surface                                     | Status               | Backed by                                                     |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| Golden Rules canon + drift-guard            | **Built**            | `goldenRules.ts`, `CODE_OF_CONDUCT.md`, `goldenRules.spec.ts` |
| `GET /api/rules/tree` + variable resolution | **Built**            | `rules.ts`, `siteVariables.ts` (ADR-0020)                     |
| Forum/Staff rule wiki pages                 | **Built** (#126)     | `wikiFixtures.ts`, `prisma/seed-wiki/`                        |
| Forum class gates                           | **Built**            | `Forum.minClass*`, `canAccessForumLevel`                      |
| Permission enforcement                      | **Built**            | ADR-0001                                                      |
| Staff structure                             | **Built**            | `StaffGroup`, `UserRank`, staff surfaces                      |
| Standing tier                               | **Built** (#124)     | `computeStanding()` — profile read only                       |
| IRC / Interview rule pages                  | **External**         | korin-pink public wiki                                        |
| `ForumSpecificRule` overlays                | **Stub**             | model only, no code                                           |
| Staff "+50 CRS/week-served"                 | **Planned**          | not a dimension in `reputation.ts`                            |
| Rule-outcome CRS scoring                    | **Deferred post-v1** | `ruleImpact()` has no callers                                 |
| CommunityRules tree                         | **Unbuilt**          | —                                                             |
