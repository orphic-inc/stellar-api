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

Computation: the CRS value is always computed on read (no stored, stale score column). Only events that current state cannot reconstruct — e.g. the Friends×Stylesheet adoption edges and their once-per-pair dedup — are append-only logged to a CRS_* reason on the existing EconomyTransaction ledger. Time-series snapshots (trends) are a deferred additive layer. See ADR-0007.

Ratio independence (decided)

Ratio (the contributed/consumed download gate, PRD-06) and CRS are layered strictly one-way:

- Ratio is a standalone enforcement mechanism. It never reads CRS — reputation, friends, or donations cannot lower a user's required ratio. The gate stays uncorruptible.
- A derived RatioScore flows one-way into this CRS (and the eventual CommunityValueIndex) as one bounded dimension among many.
- CRS never gates downloads. It is a status/trust signal, not an enforcement lever.

Implementation status (PR #96)

The registry + aggregator (computed-on-read) ship with three bounded dimensions:

- ✅ LongevityScore — account age, diminishing returns, cap 10.
- ✅ RatioScore — current ratio health, one-way, cap 8; gated on contributed > 0.
- ✅ FriendsScore — friend count, deliberately low cap 4 (count can't dominate).
- ⏳ InviteScore, DonationScore — next dimensions (#61, #62).
- Surfaced at GET /api/profile/me/reputation (score + per-dimension breakdown).

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

## Future direction — making CRS *bite* (noted 2026-06-13, not scoped)

Today CRS only *accrues* — unlike the **Ratio Mechanism**, which has real teeth (gates downloads, warns, bans), the reputation dimensions (stylesheet, IRC, …) sum into a number with no monitoring, display, or downstream effect yet. Recorded so the gap is explicit, not designed:

- **Positive-reinforcement teeth (privilege-granting).** High reputation should *unlock capability*, not gate downloads (CRS never gates downloads — that stays the Ratio Mechanism's job). E.g. a high **IRCScore** earns rights to create official channels or moderate specific community channels (see PRD-02). This is a distinct lever from ratio enforcement.
- **Staff Toolbox.** CRS (and its dimensions) surface to staff for monitoring/triage in a **Staff Toolbox** — the display/admin surface for the whole reputation system. Out of purview today.
- **Community Toolbox.** A forward-looking surface letting **Community Staff** manage their *own* community (a la the Community Do-Not-Contribute list) — where Community-scoped levers (the Community Stylesheet slot, channel moderation grants) would live. Much further down the path.

These are the home for the eventual "what does a score *do*" decisions; capturing them here keeps the dimension work (stylesheet #120, IRC) honest about being substrate, not yet consequence.
