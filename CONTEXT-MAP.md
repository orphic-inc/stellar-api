# Context Map — the Stellar constellation

Stellar's domain spans multiple repositories; one of them (`korin.pink`) is **external to the orphic-inc origin** (owned under obrien-k, its own deploy/cadence). This map points to the per-context `CONTEXT.md` for each. Skills that read domain language should consult this map, then the relevant repo's `CONTEXT.md` and ADRs. See `docs/agents/domain.md` for the consumer rules.

| Context                      | Repo                                 | Glossary                                                                                       | Decisions                                                                               | Role                                                                                |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Platform / API**           | `orphic-inc/stellar-api` (this repo) | [`CONTEXT.md`](./CONTEXT.md)                                                                   | [`docs/adr/`](./docs/adr/)                                                              | System of record — API, durable state, the contribution / ratio / CRS domain        |
| **Frontend**                 | `orphic-inc/stellar-ui`              | [stellar-ui `CONTEXT.md`](https://github.com/orphic-inc/stellar-ui/blob/main/CONTEXT.md)       | [stellar-ui `docs/adr/`](https://github.com/orphic-inc/stellar-ui/tree/main/docs/adr)   | React/TS client; the theming subsystem glossary                                     |
| **Deployment**               | `orphic-inc/stellar-compose`         | [README — operator runbook](https://github.com/orphic-inc/stellar-compose/blob/main/README.md) | [compose `docs/adr/`](https://github.com/orphic-inc/stellar-compose/tree/main/docs/adr) | Docker Compose stack; image pinning, deploy/upgrade/rollback (ADR-0027 deploy side) |
| **IRC + accounting sidecar** | `obrien-k/korin-pink` _(external)_   | [korin `docs/CONTEXT.md`](https://github.com/obrien-k/korin-pink/blob/main/docs/CONTEXT.md)    | korin `docs/adr/`                                                                       | IRC substrate (Ergo + bridge + wiki) and the Go `ledger` accounting authority       |

**Cross-repo / system-wide decisions live in this repo's `docs/adr/`** — notably [ADR-0013](./docs/adr/0013-korin-pink-irc-integration.md) (the korin↔stellar integration boundary), [ADR-0016](./docs/adr/0016-ledger-accounting-contract.md) (the consumption-accounting & ratio-gate contract), and [ADR-0018](./docs/adr/0018-development-lifecycle-and-contract-gate.md) (the development lifecycle and the enforced API/UI contract gate). Each other repo carries its own context-scoped ADRs.

## Contract hygiene — pairing API surfaces with UI tracking

When an API PR adds or changes a **UI-consumable surface** — a new route, a response-shape change, or a new OpenAPI schema — it carries a paired obligation on the frontend. Before considering the work done:

1. **Register the route in the OpenAPI contract** (`src/lib/openapi.ts`). The registry is manual: a route that exists but isn't registered is invisible to `openapi.json`, so stellar-ui's generated `src/types/api.ts` can't see it and the UI can't consume it type-safely. An unregistered route is a silent contract gap (e.g. the IRC nick-link routes shipped in #175 without registration — see #198).
2. **File a paired stellar-ui tracking issue**, linking the API PR — or explicitly note that no UI consumes the surface. A backend feature with no UI issue is how features ship half-built and untracked; the stellar-ui side does not auto-discover API work.

This keeps the API↔UI seam honest in both directions: the contract exposes what the UI needs, and the tracker reflects what's actually left to build.
