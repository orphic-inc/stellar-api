# PRD-02 — Donations, IRC, & Announce

**Status:** Stub — not yet authored · **Owner:** @obrien-k
**Referenced by:** [PRD-01](01-Community-Score.md) · [PRD-03](03-stylesheet-themes-and-scoring.md)

> This PRD covers three related subsystems that share a delivery milestone. Content TBD.

## Scope

- **Donations** — one-time + recurring + anonymous + campaign attribution; `DonationScore` dimension in CRS; `$tylesheeets` donor-unlocked stylesheet slots (cross-ref PRD-03).
- **IRC / korin.pink integration** — IRCScore dimension (formula + weighting); `KORIN_API_URL` / `KORIN_PULL_KEY` config; `feat/korin-pink` branch (already wired; pending merge). See [ADR-0005](../adr/0005-korin-pink-irc-integration.md) for architecture decisions.
- **Announce** — IRC announce bot (`POST /irc/announce` on korin API); RSS/podcast feed rendering to IRC line format.

## Status

| Area | Status |
|---|---|
| IRCScore dimension + korin polling | ✅ wired on `feat/korin-pink`; pending merge |
| IRC announce route (`POST /irc/announce`) | ✅ live in korin API |
| Donations model + DonationScore | ⏳ pending — stub models exist in schema.prisma |
| Donor stylesheet slots (`$tylesheets`) | ⏳ pending — cross-ref PRD-03 |

## Related

- Issues: [#60](https://github.com/orphic-inc/stellar-api/issues/60) Friends · [#61](https://github.com/orphic-inc/stellar-api/issues/61) InviteTree · [#62](https://github.com/orphic-inc/stellar-api/issues/62) Donations
- ADR-0005 — korin.pink IRC integration (pull vs push, nick mapping, formula constants)
