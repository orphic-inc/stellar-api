## Summary

<!-- What this PR changes and why. -->

## Linked issue(s)

<!-- e.g. "Closes #123". Every PR should trace to an issue carrying acceptance criteria. -->

Closes #

## Acceptance criteria

<!-- Copy the issue's Definition of Done and check each item as QA confirms it (ADR-0018, step 6). -->

- [ ]

## QA — agent-run (ADR-0018, step 6)

- [ ] Unit + integration tests pass.
- [ ] E2E / regression verified for the affected flows (`/verify`, Playwright / Chrome DevTools where applicable).
- [ ] OpenAPI gate green — any new/changed route is registered in `src/lib/openapi.ts` and `openapi.json` is regenerated.
- [ ] ERD gate green — `docs/erd.md` regenerated if the schema changed.

## UAT — human (ADR-0018, step 6)

- [ ] Stakeholder acceptance over the green checklist above. (This is the one step that is not delegable.)

## Security review (ADR-0018, step 7)

<!-- The "Security review gate" workflow enforces this for changes under src/middleware/**. Tick exactly one. -->

- [ ] `/security-review` completed — required for changes to `src/middleware/**` (auth, permissions, `serviceAuth`, rate limiting, validation) or any new route.
- [ ] N/A — no auth-sensitive paths touched.

## Contract & UI pairing (CONTEXT-MAP "Contract hygiene")

- [ ] Paired stellar-ui tracking issue linked, or "no UI consumes this surface" noted.
