# Runbook — verify the release-announce push path end-to-end (#299)

The announce path is stellar-authoritative and korin-delivered (ADR-0013): `announceJob` cursors over new Contributions and `announce.ts` POSTs each as a one-item RSS artifact to korin `POST /irc/announce`, which renders it into the IRC `#announce` channel. The in-process contract is covered by automated tests (`src/announce.spec.ts`, `src/modules/announceJob.spec.ts`); those pin the wire shape and the cursor/retry semantics but cannot observe the rendered IRC line. This runbook is the manual half — driving one real Contribution through a live korin and confirming it lands, correctly formatted, in the intended channel.

## What the automated tests already guarantee

- The POST body is exactly korin's `InboundFeedSchema`: `{ xmlPayload: string, templateType: 'minimal', environment: { osc8: boolean } }`, sent with the `x-pull-key` header to `${KORIN_API_URL}/irc/announce`.
- The RSS `<link>` is the plain release page (`/releases/:id`), never a tokenized download URL (notify-and-link, #136 / Golden Rule 3).
- The cursor seeds to the latest Contribution at boot (no history replay), advances only on a 2xx, and holds on failure so the item retries in order (at-least-once).

What remains manual: that a live korin accepts the payload, routes it to `#announce`, and renders the line as expected.

## Preconditions

- korin api reachable and `KORIN_API_URL` set on stellar; `KORIN_PULL_KEY` (stellar) equals korin's `STELLAR_PULL_KEY`.
- korin's `stellar-bridge` bot is joined to `#announce` and holds channel op (the channel name is load-bearing on the korin side).
- A stellar instance with the announce job running (`KORIN_API_URL` + `KORIN_PULL_KEY` both set — the job is inert otherwise).

## Fast path — direct contract smoke against korin

korin's `/irc/announce` renders synchronously and returns the artifact in the HTTP response, so the wire contract can be checked without waiting for the poll interval:

```bash
curl -sS -X POST "$KORIN_API_URL/irc/announce" \
  -H 'content-type: application/json' \
  -H "x-pull-key: $KORIN_PULL_KEY" \
  -d '{
    "xmlPayload": "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><item><title>Artist — Album [FLAC]</title><link>https://stellar.example/releases/1</link><guid isPermaLink=\"false\">stellar-contribution-1</guid><category>Music</category></item></channel></rss>",
    "templateType": "minimal",
    "environment": { "osc8": true }
  }'
```

Expect `200` with `{ "success": true, "mode": "minimal", "artifact": "<rendered IRC line>" }`. A `400` means the payload drifted from `InboundFeedSchema`; a `401` means the pull key mismatched.

## Full path — a real Contribution to the channel

1. Create a new Contribution on stellar (via the normal contribution flow, or seed one in the test DB), noting its id.
2. Wait for the next announce tick (up to `KORIN_POLL_INTERVAL_MS`, default 5 min) or restart stellar to trigger the startup tick. The cursor only picks up Contributions created after the last recorded id.
3. In an IRC client joined to `#announce`, confirm a single line appears for that Contribution.
4. Verify the rendered line:
   - category badge/icon matches the item type (contribution/release/contest/announcement);
   - the title reads `Artists — Title [Type]`;
   - the hyperlink target (OSC-8 or plain) is the release page `/releases/:id`, not a tokenized URL;
   - exactly one line per Contribution (no duplicate/replay).

## On drift

- Payload rejected (400): the stellar-side DTO diverged from `InboundFeedSchema` — fix `publishAnnounceItem` in `src/modules/announce.ts` and update the contract assertion in `src/announce.spec.ts`.
- Wrong/blank channel: the bridge is not op in `#announce` (korin-side deploy), not a stellar concern — file against korin.
- Duplicate lines: cursor advance regression — check `runAnnounceCycle` and the startup seed in `src/modules/announceJob.ts`.
