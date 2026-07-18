PRD: Community Reputation

Version 0.0.1 → 0.0.4

Related Issues

- #60 Friends
- #61 InviteTree
- #62 Donations

Related Decisions (ADR)

- [ADR-0001](../adr/0001-granular-permission-checks.md) — granular permission checks (CRS gates on per-permission checks)
- [ADR-0002](../adr/0002-community-health-pulse.md) — community-health-pulse → CommunityScore dimension (#75)
- [ADR-0006](../adr/0006-linkhealth-gated-ratio-relief.md) — LinkHealth-gated ratio relief (RatioScore substrate)
- [ADR-0007](../adr/0007-crs-read-time-and-event-ledger.md) — CRS computed-on-read + event accrual ledger

Related PRDs

- [PRD-03](03-stylesheet-themes-and-scoring.md) — stylesheet scoring is a dimension of this CRS
- [PRD-06](06-ratio.md) — the Ratio mechanism; a derived `RatioScore` feeds this CRS (one-way)
- [PRD-08](08-collages-and-cover-art.md) — Collage contribution weighting feeds the `ContributionScore` dimension

⸻

Executive Summary

This initiative introduces the first generation of Stellar’s Community Reputation System.

Communities thrive when members contribute consistently over time.

Traditional reputation systems often focus on a narrow set of measurable actions. While effective for tracking specific forms of participation, they frequently fail to capture the broader behaviors that sustain healthy communities, such as mentorship, stewardship, relationship building, communication, referrals, and long-term engagement.

Stellar introduces the CommunityReputationScore (CRS), a composite reputation model designed to evaluate a member’s overall contribution to the ecosystem.

The CommunityReputationScore rewards behaviors that strengthen community continuity, encourage participation, and increase the long-term resilience of the platform.

Rather than measuring a single activity, the score aggregates signals across multiple dimensions of participation, including social relationships, referrals, communication, financial support, community involvement, and account longevity.

The objective is not to rank popularity, but to recognize members who actively contribute to the growth, stability, and preservation of the community.

Version 0.0.1 through 0.0.4 establishes foundational social signals that will contribute toward a user’s overall community reputation.

The system introduces:

- Friend relationships
- Invitation genealogy
- Donation history
- Community contribution signals

These systems will eventually integrate with:

- IRC participation
- RSS consumption and publishing
- Community activity
- Moderation actions
- Longevity and account history

⸻

Problem Statement

Current user statistics provide visibility into account activity, but do not adequately represent a member's overall contribution to the community.

They do not adequately measure:

- Community engagement
- Trustworthiness
- Cultural contribution
- Stewardship
- Long-term investment

As a result, highly valuable members and minimally engaged members may appear equivalent despite vastly different levels of contribution.

⸻

Vision

The system favors behaviors that increase the likelihood that the community remains active, healthy, and self-sustaining over time.

A user’s reputation should reflect their overall contribution to the preservation and growth of the community.

The system should reward:

- Longevity
- Reliability
- Participation
- Referrals
- Communication
- Community stewardship
- Financial support

The system should discourage:

- Disposable accounts
- Short-term participation
- Invitation abuse
- Community extraction without contribution
- Reputation manipulation

⸻

Guiding Principles

Continuity Matters

Long-term members contribute institutional knowledge.

Account age should positively influence reputation.

⸻

Reliability Matters

Users who consistently contribute over time should be rewarded.

⸻

Relationships Matter

The quality of a user’s social graph is meaningful.

Trusted users often invite other trusted users.

⸻

Preservation Matters

Actions that preserve knowledge and activity are more valuable than passive consumption.

⸻

Contribution Matters

Users who invest resources into the platform should receive recognition.

⸻

Community Reputation Score

Overview

Every user receives a computed Community Reputation Score.

The score is not a replacement for ratio.

Instead, it serves as an additional measure of community value.

⸻

Formula

Initial implementation:

CommunityReputationScore =
FriendsScore +
InviteScore +
DonationScore +
LongevityScore

Future versions may introduce:

IRCScore
FeedScore
CommunityScore
ModerationScore
ContributionScore

⸻

Architecture (decided)

CRS is a registry of bounded, pure dimension-scorers — not a hardcoded sum.

- Each dimension is a pure function compute(user) → subScore, mirroring the shipped stylesheetScore.ts. No DB inside the scorer.
- Each dimension is bounded — diminishing returns and/or a hard cap — so no single axis can dominate. This enforces the PRD's guardrails structurally rather than by good intentions: "Friend count alone should not determine score" and "Donation value should not dominate" become caps, not hopes.
- CRS = Σ (weight_i × subScore_i), with explicit, hand-pinned weight and cap constants (no automated weighting algorithm yet — that stays out of scope). Recent participation may be weighted over historical, while still recognising longevity.
- Dimensions self-register. New dimensions (RatioScore, stylesheet, LinkHealthBonusPoints, IRC, Feed) slot in by adding a registry entry — never by editing the aggregator.
- v0.0.x dimension set: Friends, Invite, Donation, Longevity.

Computation: the CRS value is always computed on read (no stored, stale score column). Only events that current state cannot reconstruct — e.g. the Friends×Stylesheet adoption edges and their once-per-pair dedup — are append-only logged to a CRS\_\* reason on the existing EconomyTransaction ledger. Time-series snapshots (trends) are a deferred additive layer. See ADR-0007.

Ratio independence (decided)

Ratio (the contributed/consumed download gate, PRD-06) and CRS are layered strictly one-way:

- Ratio is a standalone enforcement mechanism. It never reads CRS — reputation, friends, or donations cannot lower a user's required ratio. The gate stays uncorruptible.
- A derived RatioScore flows one-way into this CRS (and the eventual CommunityValueIndex) as one bounded dimension among many.
- CRS never gates downloads. It is a status/trust signal, not an enforcement lever.

Implementation status

The registry + aggregator (computed-on-read, PR #96) ship the full v0.0.x dimension formula plus dimensions brought forward from later versions:

- ✅ LongevityScore — account age, diminishing returns, cap 10.
- ✅ RatioScore — current ratio health, one-way, cap 8; gated on contributed > 0.
- ✅ FriendsScore — accepted friendships, deliberately low cap 4 (count can't dominate); also carries the Friends×Stylesheet controlled vector (PRD-03 #147).
- ✅ InviteScore — direct invitees only, cap 5; active+contributing and long-lived invitees raise it, banned and warned/dormant invitees erode it, net floored at 0 (#61 substrate + #192 dimension).
- ✅ DonationScore — supportConsistency + supportLongevity, cap 3 (the lowest), deliberately amount-agnostic so value can't dominate (#62 substrate + #192 dimension).
- ✅ IRCScore (**cap 2** — a deliberately thin signal until real IRC traffic exists, #141; ADR-0013) and StylesheetScore (cap 6, PRD-03, with the #121 tier-escalation curve) — registered ahead of the v0.0.x roadmap. **No dead-link penalty ships**: #122 proposed a signed −1 and was closed 2026-07-18 (see "Scoping decisions (2026-07-18)" below). StylesheetScore has no floor and is positive-only. StylesheetScore is slated to fold into the Contests umbrella as a sub-signal at cap 3 — see Planned dimensions.
- ✅ CommunityScore (signed, cap +4/floor −1, #75/ADR-0017) and LinkHealthScore (lifetime PASS-uptime, cap 8, #95/ADR-0019).
- **The label "v0.0.x" is stale — nine dimensions ship today.** The formula is version-agnostic and self-registering; new dimensions slot into the same registry without touching the aggregator.
- Surfaced two ways: GET /api/profile/me/reputation (own score + per-dimension breakdown), and — as of #193 — a paranoia-gated `community` block on every profile (GET /api/profile/me and /user/:id) carrying friends count, invite summary, and the reputation view. The block is hidden at the top paranoia tier, and its snatch-derived `ratio` dimension drops out when the viewer can't see consumed stats.

Planned dimensions (scoped 2026-06-23, design — not built)

The 9 live dimensions round out to ~12 with these. **The live cap budget is 52** at uniform weight 1.0 (longevity 10, ratio 8, linkHealth 8, stylesheet 6, friends 4 + adoption vector 2, invite 5, community +4, donation 3, irc 2). An earlier revision of this document said ≈48; that was stale, corrected 2026-07-18.

**The sum is allowed to float** (decided 2026-07-18). Nothing gates on an absolute CRS value — ADR-0028 firewalls classes from CRS, and the score is read-time display only — so a growing budget has no functional consequence. What it does affect is the **trend layer**: `CrsSnapshot.score` is a time series, and when the achievable maximum moves, historical points stop meaning what current ones mean. The answer is to mark the break rather than hide it: `CrsSnapshot` carries a **`formulaVersion`**, bumped whenever any cap or weight changes, and trends are only comparable within a version. Renormalising every dimension to hold a constant total was rejected — it makes a formula change look like a member's decline, which is exactly the confusion the version field prevents.

- **ContributionScore** — the keystone ("Contribution is king"). Bounded peer at **cap 10 / weight 1.0** (joint-largest with Longevity, but cannot dominate — the no-single-axis-dominates guardrail holds). Rewards quality-graded contribution volume via `gradeContribution` (#76), diminishing returns. Grading refinements pinned: per-file `logScore` granularity (Perfect = log 100% + cue > log 100% no cue > lower log% cascading); distinct **320 > V0 > V2** steps (today 320≡V0, 256≡V2); video source/resolution ladder (4K UHD BD → 1080p ≈ "320" → … → TS); eBooks **popularity-graded** off consumer + snatch count, not fidelity. **`isScene` is a significant detriment EXCEPT when it is the only available copy — then the penalty is suppressed and the grade is restored ("availability beats purity"); `isScene` is disallowed at upload on public communities, the penalty being the safety net.** Needs schema: a `logScore` field and video source/resolution enums.
- **Leadership / User Class** (#218) — **signed**: holding CommunityLeader / Staff / Stellarific+ earns a bonus, but poor standing as a leader digs a _deeper_ hole than for a rank-and-file member (higher role = higher standard). **Subsumes** the legacy StaffRules "+50 CRS/week-served" flat accrual, which was unbounded (a 2-year staffer would dwarf the whole formula); the bounded signed dimension is its principled home.
- **Contests** (#227) — **cap 10**, an **umbrella for original creative work contributed to Stellar itself**. Sub-signals are **independently capped, summed, then clamped at the umbrella cap** (decided 2026-07-18) — they are not proportional shares of one pool. "Vanity House dominates" describes what typically drives the score on a music-first site, not a fixed allocation; a member strong in several sub-signals reaches the clamp.

  | Sub-signal           | Sub-cap | Notes                                                                            |
  | -------------------- | ------- | -------------------------------------------------------------------------------- |
  | Vanity House         | 6       | the member's original _musical_ contributions — the primary driver               |
  | Stylesheet           | 3       | folded in from the standalone dimension; see below                               |
  | Wiki                 | 2       | durable curated content; the surviving half of the old Forum/Wiki dimension      |
  | Cover Art / Collages | 2       | PRD-08                                                                           |
  | Contests-proper      | 2       | compilations of Vanity House artists; Signature/Avatar of the Week; Monthly zine |

  **Stylesheet folds in** (decided 2026-07-18, reversing "not folded yet"). Authoring a stylesheet others adopt and contributing to Vanity House are the same act — a member giving original creative work to Stellar — so they belong under one umbrella, and the fold resolves the acknowledged double-count. **Its ceiling drops from 6 to 3**: under the new model a stylesheet is one _kind_ of creative contribution rather than its own axis. Per ADR-0007 CRS is computed at read time, so **existing authors' scores move the moment this ships** — no grandfathering, accepted deliberately. Bump `formulaVersion` when it lands.

- **Concerts** — **blocked on a dependency, not a design question**: needs the removed **Calendar** model rebuilt (the Concert model exists; Calendar was dropped as an early PoC stub). Belongs to the Staff Toolbox surface. Nothing to decide until that surface exists (#229).
- **Forum/Wiki engagement** — **resolved 2026-07-18 by splitting it.** The placement was undecided because the issue bundled two different acts. **Wiki → a Contests sub-signal (cap 2)**: a wiki article is literally a contribution to Stellar's own repository, and revisions are attributable, revertible, and peer-visible, so the signal polices itself. **Forum → not scored.** The only forum signal available is post volume, and volume is the sole ungated input in the model — every other dimension has a scarce gate (adoptions need adopters, invites need invitees, ratio needs bytes, link health needs uptime), while anyone can post indefinitely. `ForumPost` carries no quality signal (no thanks, likes, or solved-marking), so there is nothing better to score. Revisit only if a forum quality signal is built; that is a forum feature decision, not a CRS one (#235).

Scoping decisions (2026-06-23)

- **Negative CRS is a review flag + a drag on the number — never an automated execution.** A −1 does not auto-prune a member. Pruning/sweep is a link-health lifecycle action on dead _content_, not on a member's reputation score (consistent with #155 "suspect is not condemned" and the CRS-never-gates principle). Reputation consequences are HITL / privilege-layer.
- **Calibration / "The Final Score" is NOT a CRS dimension.** It measures the _codebase/migration_ (typing coverage, Zod validation, Tailwind/stylesheet implementation, CI/CD reliability) — a project self-assessment, a different axis-space from per-member reputation. It gets its own ADR + dashboard and ties to the v0.7.0 CI/CD readiness goal; it must not be slotted into `computeCrs`.

Scoping decisions (2026-07-18)

- **A CRS penalty requires community harm.** #122 proposed a signed −1 when a member's `UserSettings.externalStylesheet` URL goes dead. Closed wontfix: that field is owner-only (`profile.ts` returns it solely when `viewer.isOwner`, alongside `paranoia` and notification preferences) and themes the holder's own view, so a dead URL degrades nobody's experience but the holder's. CRS measures standing in the community; a member breaking their own theme is not a reputational event, and "your standing dropped because a CDN you pointed at went offline, which only you could see" is not a defensible notification. This is the line for any future negative dimension — contrast **LinkHealthScore**, which penalises dead _contribution_ links precisely because those deny content to other members. Note also that no publicly-consumed stylesheet URL exists in the model at all: `AuthorStylesheet.source` is inline CSS, not a link.
- **PRD-03's descent requirement is already met.** #122 was carrying the "CRS must be able to go down" target, but negative CRS ships today in two dimensions — `community` (floor −1) and the contagion vector. Closing #122 does not leave the model positive-only.
- **The cap budget floats; the trend layer versions.** See "Planned dimensions" above for the `formulaVersion` decision and why renormalisation was rejected.
- **Dependency-blocked is not design-blocked.** #229 (Concerts → Calendar model) and #236 (IRCScore teeth → Staff/Community Toolbox) were both carrying `[design]` framing, but neither has an open design question — each waits on an unbuilt surface. They should be labelled and triaged as dependencies so they stop reading as undecided product calls.

⸻

Friends System

Purpose

Represent trust relationships between users.

Friends provide a lightweight social graph.

⸻

Requirements

Users may:

- Send friend requests
- Accept requests
- Remove friends

⸻

Model

FriendRelationship {
requesterId
recipientId
status:
| pending
| accepted
| rejected
createdAt
}

⸻

Scoring

Friend count alone should not determine score.

Friend relationships are treated as trust signals rather than popularity indicators.

The system should prioritize relationship quality, account reputation, and network diversity over raw friend counts.

Future versions may consider:

- Friend account age
- Mutual communities
- Interaction frequency

⸻

InviteTree

Purpose

Represent referral genealogy.

Invite trees establish accountability and trust inheritance.

Invite relationships are directional and permanent.

⸻

Requirements

Track:

- Inviter
- Invitee
- Tree depth
- Branch relationships

⸻

Model

InviteTree {
parentUserId
childUserId
level
branch
createdAt
}

⸻

Scoring

Users inherit reputation from successful invitations.

Positive signals:

- Active invitees
- Long-lived invitees
- Contributing invitees
- High reputation invitees

Negative signals:

- Banned invitees
- Dormant invitees
- Abandoned accounts
- Warned invitees

⸻

Donations

Purpose

Recognize financial support.

Financial support may contribute to reputation, but donations must never outweigh meaningful participation, trust, or community contribution.

⸻

Model

Donation {
userId
amount
currency
campaign
createdAt
}

⸻

Requirements

Support:

- One-time donations
- Recurring donations
- Anonymous donations
- Campaign attribution

⸻

Scoring

Donation value should not dominate reputation.

Instead:

DonationScore =
supportConsistency +
supportLongevity

The goal is recognition, not pay-to-win.

⸻

Profile Integration

Stats Section

Current profile statistics will be expanded.

Example:

Member Since
Friends
Invited Users
Invite Tree Depth
Donation History
Community Reputation
Community Participation

Status (#193): Member Since, Friends count, Invited Users + Invite Tree Depth, and Community Reputation are surfaced via the paranoia-gated `community` block on the profile; Community Participation is approximated by the existing activity summary. **Donation History on the profile is the remaining unbuilt field** — deferred pending the donation-visibility/anonymity decision (donations are admin-only today, and the PRD allows anonymous donations).

⸻

Future Social Signals

IRC Activity

Planned for v0.1.x

Measures:

- Presence
- Conversation participation
- Community engagement
- Event coordination

Potential weighting:

IRCScore =
activity _
consistency _
channelQuality

⸻

RSS / Feed Activity

Measures:

- Feed publishing
- Feed subscriptions
- Announcement participation

Potential weighting:

FeedScore =
publications +
subscriptions +
engagement

⸻

Community Participation

Measures:

Recent participation should generally carry greater weight than historical participation, while still recognizing long-term contribution and account longevity.

- Comments
- Contributions
- Group creation
- Community moderation

⸻

Community Value Index

Long-term objective:

CommunityValueIndex =
RatioScore

- CommunityReputationScore
- CommunityParticipationScore
- IRCScore
- FeedScore

This score represents the overall value a member contributes to Stellar.

CommunityReputationScore is intended to measure contribution, reliability, and continuity. The system favors behaviors that increase the likelihood that the community remains active, healthy, and self-sustaining over time.

In Scope

- Friend relationships
- InviteTree implementation
- Donation tracking
- CommunityReputationScore foundation
- Profile statistics integration

Out of Scope

- IRC scoring
- RSS scoring
- Community participation scoring
- Moderation scoring
- Automated weighting algorithms
- CommunityValueIndex calculation

## Future direction — making CRS _bite_ (noted 2026-06-13, not scoped)

Today CRS only _accrues_ — unlike the **Ratio Mechanism**, which has real teeth (gates downloads, warns, bans), the reputation dimensions (stylesheet, IRC, …) sum into a number with no monitoring, display, or downstream effect yet. Recorded so the gap is explicit, not designed:

- **Positive-reinforcement teeth (privilege-granting).** High reputation should _unlock capability_, not gate downloads (CRS never gates downloads — that stays the Ratio Mechanism's job). E.g. a high **IRCScore** earns rights to create official channels or moderate specific community channels (see PRD-02). This is a distinct lever from ratio enforcement.
- **Staff Toolbox.** CRS (and its dimensions) surface to staff for monitoring/triage in a **Staff Toolbox** — the display/admin surface for the whole reputation system. Out of purview today.
- **Community Toolbox.** A forward-looking surface letting **Community Staff** manage their _own_ community (a la the Community Do-Not-Contribute list) — where Community-scoped levers (the Community Stylesheet slot, channel moderation grants) would live. Much further down the path.

These are the home for the eventual "what does a score _do_" decisions; capturing them here keeps the dimension work (stylesheet #120, IRC) honest about being substrate, not yet consequence.
