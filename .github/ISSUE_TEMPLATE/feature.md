---
name: Feature / enhancement
about: A new capability or change to existing behavior, with its Definition of Done
labels: needs-triage
---

## Context

<!-- What behavior do we want, and why? For parity-driven work, describe the target behavior on its own terms (capabilities, flows) — do not name any prior/legacy system (ADR-0018, step 1). For net-new work, describe the product intent. -->

## Acceptance criteria (Definition of Done)

<!-- The testable checklist that QA verifies (ADR-0018, step 6). Be specific enough that "done" is observable, not a matter of opinion. -->

- [ ]
- [ ]

## Contract & UI pairing

<!-- Per CONTEXT-MAP "Contract hygiene" and ADR-0018 steps 2/4. Delete the line that doesn't apply. -->

- [ ] This adds/changes a UI-consumable surface → the route is (or will be) registered in `src/lib/openapi.ts`, and a paired stellar-ui tracking issue is linked here.
- [ ] No UI consumes this surface (internal/CI/infra change).

## Notes

<!-- Links to PRD/ADR, related issues, constraints. -->
