PRD: Community Reputation

Version 0.0.1 → 0.0.4

Related Issues

* #60 Friends
* #61 InviteTree
* #62 Donations

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

* Friend relationships
* Invitation genealogy
* Donation history
* Community contribution signals

These systems will eventually integrate with:

* IRC participation
* RSS consumption and publishing
* Community activity
* Moderation actions
* Longevity and account history

⸻

Problem Statement

Current user statistics provide visibility into account activity, but do not adequately represent a member's overall contribution to the community.

They do not adequately measure:

* Community engagement
* Trustworthiness
* Cultural contribution
* Stewardship
* Long-term investment

As a result, highly valuable members and minimally engaged members may appear equivalent despite vastly different levels of contribution.

⸻

Vision

The system favors behaviors that increase the likelihood that the community remains active, healthy, and self-sustaining over time.

A user’s reputation should reflect their overall contribution to the preservation and growth of the community.

The system should reward:

* Longevity
* Reliability
* Participation
* Referrals
* Communication
* Community stewardship
* Financial support

The system should discourage:

* Disposable accounts
* Short-term participation
* Invitation abuse
* Community extraction without contribution
* Reputation manipulation

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

Friends System

Purpose

Represent trust relationships between users.

Friends provide a lightweight social graph.

⸻

Requirements

Users may:

* Send friend requests
* Accept requests
* Remove friends

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

* Friend account age
* Mutual communities
* Interaction frequency

⸻

InviteTree

Purpose

Represent referral genealogy.

Invite trees establish accountability and trust inheritance.

Invite relationships are directional and permanent.

⸻

Requirements

Track:

* Inviter
* Invitee
* Tree depth
* Branch relationships

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

* Active invitees
* Long-lived invitees
* Contributing invitees
* High reputation invitees

Negative signals:

* Banned invitees
* Dormant invitees
* Abandoned accounts
* Warned invitees

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

* One-time donations
* Recurring donations
* Anonymous donations
* Campaign attribution

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

* Presence
* Conversation participation
* Community engagement
* Event coordination

Potential weighting:

IRCScore =
  activity *
  consistency *
  channelQuality

⸻

RSS / Feed Activity

Measures:

* Feed publishing
* Feed subscriptions
* Announcement participation

Potential weighting: 

FeedScore =
  publications +
  subscriptions +
  engagement

⸻

Community Participation

Measures:

Recent participation should generally carry greater weight than historical participation, while still recognizing long-term contribution and account longevity.

* Comments
* Contributions
* Group creation
* Community moderation

⸻

Community Value Index

Long-term objective:

CommunityValueIndex =
  RatioScore
+ CommunityReputationScore
+ CommunityParticipationScore
+ IRCScore
+ FeedScore

This score represents the overall value a member contributes to Stellar.

CommunityReputationScore is intended to measure contribution, reliability, and continuity. The system favors behaviors that increase the likelihood that the community remains active, healthy, and self-sustaining over time.

In Scope

* Friend relationships
* InviteTree implementation
* Donation tracking
* CommunityReputationScore foundation
* Profile statistics integration

Out of Scope

* IRC scoring
* RSS scoring
* Community participation scoring
* Moderation scoring
* Automated weighting algorithms
* CommunityValueIndex calculation