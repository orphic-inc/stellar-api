# Ratio watch is public; an enforcement state is not a privacy preference

**Status: Accepted (2026-09-30).** Decided in the grill on [#658](https://github.com/orphic-inc/stellar-api/issues/658). It narrows what [ADR-0046](0046-privacy-is-five-flags-not-a-level.md)'s privacy flags cover, and reads the policy state that [ADR-0044](0044-a-ratio-disable-records-its-cause.md) records.

## Context

`GET /profile/me/ratio` was the only route that returned a member's ratio policy state, and only to that member. The staff policy tool (`GET /ratio-policy/{userId}`, `ratio_policy_manage`) is reached by typing a member's id into a separate page. So no viewer of a profile could see that its member was on ratio watch or had downloads disabled, including staff about to act on that member.

ADR-0046 makes five flags the whole of a member's privacy state. `showRatioStats` hides the ratio, and the watch's figures reveal part of it: the bytes still owed are the required ratio times `consumed`, less `contributed`.

## Decision

### 1. Privacy is a privilege

The five flags let a member choose what others see of their figures. They do not cover an enforcement state. **An active ratio watch shows on the member's profile to every viewer, whatever `showRatioStats` says.**

### 2. Every viewer sees an active watch, and nothing else

`PublicProfile.ratioWatch` is non-null only while all three hold:

- the policy status is `WATCH`;
- `watchExpiresAt` is in the future;
- the member is still short: the **Watch Deficit** is above zero.

It carries `expiresAt`, `deficit` (the Watch Deficit) and `consumedSinceWatch`, with byte figures as strings. `OK` and `DOWNLOAD_DISABLED` look the same to a viewer: `ratioWatch` is null.

### 3. The status is for `ratio_policy_manage`

`PublicProfile.ratioPolicy` carries `status` and `disabledCause`, and is non-null only for a viewer holding `ratio_policy_manage`, the owner included. A disable is a moderation fact, and a `STAFF` disable especially, so it stays with the staff who manage the policy. The permission reveals the status and nothing else that `isStaff` discloses, as `canSeeInviteBalance` does for the invite balance (#655).

### 4. The cost lands only on a watched member

The required ratio needs a read over the member's contributions (`getEligibleContributionBytes`). The profile makes that read only for an unexpired `WATCH`. Every other profile load costs one indexed read of the policy row.

## Consequences

- **Not a leak to fix.** A reviewer reading ADR-0046 may see `ratioWatch` on a member with `showRatioStats` off as a privacy defect. It is deliberate, and this record is the reason.
- **The member's own view is unchanged.** `GET /profile/me/ratio` still serves the owner's notice (#646). The owner also receives `ratioWatch` on their profile, like any viewer, and the ui shows its own notice there instead.
- **The ui half** is [stellar-ui#417](https://github.com/orphic-inc/stellar-ui/issues/417): the box on the profile, the staff status, and a deep link into the staff tool.
