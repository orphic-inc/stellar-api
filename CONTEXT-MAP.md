# Context Map — the Stellar constellation

Stellar's domain spans multiple repositories; one of them (`korin.pink`) is **external to the orphic-inc origin** (owned under obrien-k, its own deploy/cadence). This map points to the per-context `CONTEXT.md` for each. Skills that read domain language should consult this map, then the relevant repo's `CONTEXT.md` and ADRs. See `docs/agents/domain.md` for the consumer rules.

| Context                      | Repo                                 | Glossary                                                                                    | Decisions                  | Role                                                                          |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| **Platform / API**           | `orphic-inc/stellar-api` (this repo) | [`CONTEXT.md`](./CONTEXT.md)                                                                | [`docs/adr/`](./docs/adr/) | System of record — API, durable state, the contribution / ratio / CRS domain  |
| **Frontend**                 | `orphic-inc/stellar-ui`              | [stellar-ui `CONTEXT.md`](https://github.com/orphic-inc/stellar-ui/blob/main/CONTEXT.md)    | stellar-ui `docs/adr/`     | React/TS client; the theming subsystem glossary                               |
| **IRC + accounting sidecar** | `obrien-k/korin-pink` _(external)_   | [korin `docs/CONTEXT.md`](https://github.com/obrien-k/korin-pink/blob/main/docs/CONTEXT.md) | korin `docs/adr/`          | IRC substrate (Ergo + bridge + wiki) and the Go `ledger` accounting authority |

**Cross-repo / system-wide decisions live in this repo's `docs/adr/`** — notably [ADR-0013](./docs/adr/0013-korin-pink-irc-integration.md) (the korin↔stellar integration boundary) and [ADR-0016](./docs/adr/0016-ledger-accounting-contract.md) (the consumption-accounting & ratio-gate contract). Each other repo carries its own context-scoped ADRs.

> stellar-ui's `CONTEXT.md` currently lands via the `wip/theming-corpus` branch (PR pending); the link resolves once merged.
