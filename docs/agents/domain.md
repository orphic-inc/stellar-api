# Domain Docs

How the engineering skills should consume this project's domain documentation when exploring the codebase. Stellar is a **multi-context** project spread across repositories; one context (`korin.pink`) is external to the orphic-inc origin.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it indexes one `CONTEXT.md` per context (this repo's platform/API context, stellar-ui's frontend context, and external korin.pink's IRC+ledger context). Read the context(s) relevant to your topic.
- The relevant repo's **`CONTEXT.md`** for its domain glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Cross-repo / system-wide decisions (e.g. ADR-0013 korin integration, ADR-0016 accounting contract) live in **this** repo's `docs/adr/`; each other repo carries its own context-scoped ADRs.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context, cross-repo (presence of `CONTEXT-MAP.md` at the root):

```
stellar-api/   (this repo · orphic-inc)
├── CONTEXT-MAP.md       ← indexes every context's CONTEXT.md
├── CONTEXT.md           ← platform / API context
└── docs/adr/            ← system-wide + API-scoped decisions

stellar-ui/    (orphic-inc)
└── CONTEXT.md           ← frontend / theming context

korin.pink/    (obrien-k · external)
└── docs/CONTEXT.md      ← IRC + ledger accounting context
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant context's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids, and don't reach for legacy-reference vocabulary in anything committed.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0013 (korin-pink-irc-integration) — but worth reopening because…_
