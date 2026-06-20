# ADR-0018: Development lifecycle and the API/UI contract gate

**Status:** Accepted (2026-06-20)
**Date:** 2026-06-20
**Repos:** orphic-inc/stellar-api, orphic-inc/stellar-ui (+ external obrien-k/korin-pink)
**Relates:** [ADR-0009 — fork workflow & dependency discipline](0009-fork-workflow-and-dependency-discipline.md), [ADR-0010 — trunk-based single-branch workflow](0010-trunk-based-single-branch-workflow.md), [ADR-0013 — korin.pink IRC integration](0013-korin-pink-irc-integration.md), [ADR-0016 — consumption accounting & ratio-gate contract](0016-ledger-accounting-contract.md)
**Tracks:** the OpenAPI freshness gate fix ([#204](https://github.com/orphic-inc/stellar-api/issues/204))

---

## Context

The constellation already has a working delivery loop: establish target behavior, write a PRD/ADR with `/grill-with-docs`, build the API test-first with `/tdd`, file the matching stellar-ui work, build the UI test-first, verify, integrate via Stellar Compose, and sweep stale branches with `/mr-robot`. The loop is sound in skeleton. A QA review of it surfaced three defects that are worth settling as a decision rather than carrying as tribal knowledge, because each is a recurring failure mode rather than a one-off.

First, the API→UI handoff is an unguarded seam. The OpenAPI contract (`src/lib/openapi.ts`, exported to `openapi.json`) is what stellar-ui consumes to generate its `src/types/api.ts`; the CONTEXT-MAP contract-hygiene rule already names an unregistered route as a silent contract gap (the IRC nick-link routes that shipped in #175 without registration, tracked by #198, are the worked example). The drift between the two repos' view of the contract is a known, repeating problem — a process defect, not an isolated bug.

Second, the guard that is supposed to catch that drift is inert. The CI step `npm run openapi:export && git diff --exit-code openapi.json` cannot fail, because `openapi.json` is gitignored and untracked, so the diff compares against nothing. Its sibling ERD freshness step (`npm run db:erd && git diff --exit-code docs/erd.md`) is real only because `docs/erd.md` is committed. We have the right gate shape and the wrong tracking state.

Third, the lifecycle conflates QA with UAT. Verification against a spec (QA) is largely delegable to an agent; stakeholder acceptance (UAT) is, by definition, not. Treating them as one manual step both over-burdens the human and under-uses the automation available.

This ADR codifies the revised lifecycle, splits QA from UAT, and makes the contract seam an enforced gate rather than a convention.

## Decision

Adopt the following lifecycle. Steps 1–8 below supersede the prior informal sequence; the substantive changes are reference-neutral framing of step 1, a contract-first split between steps 2–4, per-issue acceptance criteria as a Definition of Done, an explicit rework loop, the QA/UAT split at step 6, and a security + cross-repo integration gate at step 7.

| #   | Step                                                   | What it produces                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Reference-implementation parity (gap analysis)**     | A parity gap list                                                 | Establish target behavior by gap analysis against a known-good reference implementation, described on its own terms — capabilities and flows, never by identity. No prior/legacy system is named in the docs (per the repo's no-legacy-references discipline). Net-new features that have no reference enter here too, sourced from product intent rather than a gap.           |
| 2   | **PRD/ADR via `/grill-with-docs`**                     | A PRD/ADR + a **frozen OpenAPI surface**                          | Standardize the pattern _and_ freeze the contract surface the UI will consume. The route registration in `src/lib/openapi.ts` is part of "spec done," not an afterthought at PR time.                                                                                                                                                                                           |
| 3   | **API implementation via `/tdd`**                      | API + tests + registered routes                                   | Red-green-refactor. The frozen surface from step 2 is the contract; every public route binds a `zod-to-openapi` registry mapping.                                                                                                                                                                                                                                               |
| 4   | **File paired stellar-ui issue(s)**                    | A linked UI tracking issue (or an explicit "no UI consumes this") | Authored against the **frozen contract**, so it can begin **in parallel with step 3** — UI work stubs against generated types rather than waiting on a fully-built API. This is the CONTEXT-MAP pairing obligation, promoted into the lifecycle.                                                                                                                                |
| 5   | **UI implementation via `/tdd`**                       | UI + tests                                                        | Consumes the regenerated `src/types/api.ts`; type drift here is caught by the gate (below), not by review.                                                                                                                                                                                                                                                                      |
| 6   | **QA, then UAT**                                       | A pass/fail QA report, then human acceptance                      | **QA** (verification against the issue's acceptance criteria) is run by Claude Code — automated E2E + regression via the Playwright / Chrome DevTools MCP servers, plus `/verify` and `/run` — and emits a pass/fail report. **UAT** is the thin human layer on top: the stakeholder judges acceptance over an already-green checklist, rather than hunting for what is broken. |
| 7   | **Security review + cross-repo integration → Compose** | Integrated, deployed change                                       | Run `/security-review` before integration for anything touching `middleware/`, `serviceAuth`, or new routes. Exercise the cross-repo seams (UI-against-real-API; api-against-external-korin, ADR-0013/0016) before handing to Stellar Compose.                                                                                                                                  |
| 8   | **Post-deploy smoke + `/mr-robot` sweep**              | A verified deploy + a clean branch set                            | Deploying is not verifying: run a post-deploy smoke check (Sentry is wired) before considering the change live. Then sweep stale branches, tags, and CHANGELOG with `/mr-robot`.                                                                                                                                                                                                |

Cross-cutting decisions that the table assumes:

- **Reference-implementation parity (step 1).** The reference is a behavioral oracle described on its own terms; step 1's output is a parity gap list that feeds the PRD/ADR step. The docs never name the system the reference happens to be.
- **Contract-first / parallelize API & UI.** Freezing the OpenAPI surface in step 2 lets the UI issue (step 4) and UI build (step 5) proceed against the contract in parallel with the API build (step 3), instead of strictly behind it.
- **Enforce the contract seam.** The OpenAPI freshness gate must be a real gate, mirroring the working ERD gate — an unregistered or drifted route fails CI rather than shipping as a silent gap. The mechanical fix (track `openapi.json` so `git diff --exit-code` means something) is filed as a separate, separately-reviewed change.
- **Per-issue acceptance criteria as Definition of Done.** PRDs/ADRs standardize patterns; they are not per-issue test plans. Each issue additionally carries a testable acceptance checklist, and that checklist _is_ the input to step 6's QA.
- **Explicit rework loop.** A failed QA or UAT reopens the issue back to step 3 (API) or step 5 (UI). The arrow is named rather than implied, so a failure has a defined destination.
- **QA vs UAT are different steps with different owners.** Claude Code owns QA + E2E + regression and reports; the human owns acceptance. Acceptance cannot be delegated; QA largely can.

## Rationale

- **The seam that drifts is the seam that ships half-built.** Making the contract a step-2 deliverable and a real CI gate moves drift detection left, from human review (where it is missed) to CI (where it is mechanical). This is the same move that makes the ERD gate trustworthy.
- **Parallelism is the agile lever at this scale**, not ceremony. A small agent-plus-human team gains far more from small batch size and a frozen contract than from sprint ritual. Contract-first is what unlocks API/UI parallelism without integration surprises.
- **Delegate verification, reserve acceptance.** Splitting step 6 lets the agent absorb the laborious, repeatable part (regression, E2E, a11y) and shrinks the human surface to the judgment that only the stakeholder can make. Conflating them wastes the automation and tires the human.
- **Deploying is not verifying.** A post-deploy smoke check closes the loop that integration alone leaves open, and it is cheap given Sentry is already wired.

## Consequences

- Step 2 grows a contract-freeze obligation; step 4 can start earlier; step 6 becomes two sub-steps with distinct owners and artifacts (a QA report and an acceptance sign-off). Issues grow an acceptance-criteria section that becomes the test plan.
- CI gains a _real_ OpenAPI freshness gate once `openapi.json` is tracked. Until that lands, the gate remains inert and the seam is guarded only by convention — so the tracked fix is the load-bearing follow-on, not optional polish.
- A security-review gate at step 7 adds a checkpoint for auth/permission/service-key surfaces, which are the highest-risk changes in this codebase.
- This ADR is process, not product: it introduces no schema, no route, and no glossary term, and it is purely additive — teams already following the informal loop are mostly formalizing what they do, plus the contract gate and the QA/UAT split.

## Alternatives rejected

- **Heavyweight Scrum ceremony (sprints, estimation, standups).** Wrong shape for an effectively solo-human-plus-agent team; the cost is ritual and the benefit (coordination across many people) does not apply. Kanban-style flow with small batches fits better.
- **Keep API and UI strictly sequential.** Simpler to describe, but it serializes work that the contract lets us parallelize and pushes all integration risk to the end. Contract-first costs a little discipline in step 2 to buy parallelism and earlier drift detection.
- **Keep relying on review to catch contract drift.** This is the status quo, and the #175/#198 episode plus the recorded stellar-ui type drift show it does not hold. A mechanical gate is cheaper and does not forget.
- **Codify step 1 as parity against the named prior system.** Rejected: it would write a legacy system's identity into our docs, against the repo's no-legacy-references discipline. "Reference-implementation parity, described on its own terms" keeps the practice without the identity.

## Cross-references

- **stellar-api:** ADR-0009 / ADR-0010 (the workflow ADRs this lifecycle sits on top of) · ADR-0013 & ADR-0016 (the cross-repo seams step 7 must exercise) · `CONTEXT-MAP.md` "Contract hygiene" (the pairing obligation promoted into steps 2 and 4) · [#204](https://github.com/orphic-inc/stellar-api/issues/204) (de-inert the OpenAPI freshness gate — the load-bearing follow-on).
- **stellar-ui:** the generated `src/types/api.ts` consumer of the frozen contract; paired tracking issues per step 4.
- **korin.pink:** the external integration boundary (ADR-0013/0016) that step 7's cross-repo integration covers.
