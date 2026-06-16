# PRD-07 — Donations

**Status:** Stub — not yet authored · **Owner:** @obrien-k · **Extends:** [PRD-01 Community-Score / CRS](01-Community-Score.md)
**Numbering:** PRD-01 Community-Score · PRD-02 IRC & Announce · PRD-03 Stylesheets · PRD-04 Contribution/Release/Music · PRD-05 Rules & Governance · PRD-06 Ratio · **PRD-07 Donations** · PRD-08 Collages & Cover Art

> Donations were split out of the original combined PRD-02 once IRC & Announce shipped on their own ([PRD-02](02-irc-and-announce.md)). This PRD owns the donation subsystem only; IRC/Announce content lives in PRD-02.

## Scope

- **Donations** — one-time + recurring + anonymous + campaign attribution.
- **DonationScore** — a CRS dimension fed by donation history (formula + weighting TBD).
- **Donor-unlocked stylesheet slots** — donation-gated stylesheet slot grants (cross-ref [PRD-03](03-stylesheet-themes-and-scoring.md)).

## Status

| Area                                 | Status                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Donations model + DonationScore      | ⏳ pending — stub models exist in schema.prisma                         |
| Donor stylesheet slots               | ⏳ pending — cross-ref PRD-03                                           |
| Donations history route + admin view | ⏳ pending — [#62](https://github.com/orphic-inc/stellar-api/issues/62) |

## Related

- Issues: [#62](https://github.com/orphic-inc/stellar-api/issues/62) Donations history route + admin view
- Stub models in `schema.prisma`: `Donation`, `BitcoinDonation`, `DonorReward`, `DonorRank`, `UserDonorRank`, `DonorForumUsername`
