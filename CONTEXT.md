# Stellar API

A strict, type-safe REST API using Express, Prisma (PostgreSQL), and Zod. This service implements auto-generated OpenAPI documentation, production log streams, and strict string sanitization.

Stellar is a next-generation **community and content tracker** — an invite-only platform of Communities whose members contribute and consume hosted content (Contributions are Download URLs), with contribute/consume accounting, link-health, and a Community Reputation Score.

**Runtime Entry**: `src/index.ts` (Builds to `dist/index.js` via `tsc`)
**Dev Loop**: Driven by `nodemon` watching `src/**/*.ts` executing via `ts-node --esm`
**Database Engine**: Prisma ORM connected to PostgreSQL (`pg`)
**Observability**: Winston for application event streaming + Sentry for error tracing

## Language

**Contract Schema:**
A Zod definition containing extended metadata properties that explicitly generates structural API responses, request schemas, and auto-generated OpenApi documentation.
_Avoid_: validation rule, raw validation, types schema

**Data Client:**
The standalone exported instance of Prisma Client mapping directly to the underlying PostgreSQL connection lifecycle.
_Avoid_: pool client, database hook, db runner

**Sanitized Value**:
A user-provided string mutation processed through `isomorphic-dompurify` and `jsdom` to actively strip malicious HTML/XSS vectors before passing to a service block or database operation.
_Avoid_: clean string, checked text, escaped data

**Identity State**:
The post-middleware payload containing the decrypted JWT data decoded from incoming headers or `cookie-parser` cookies, systematically exposed inside `Express.Request.user`.
_Avoid_: active passport, logged-in session, user record

**Integration Database**:
The isolated, transactional test database targeting custom parameters from `.env.test` executed via `npm run test:integration` inside `jest`.
_Avoid_: live testing database, local test instance

**Effective Availability**:
A contribution is effectively available — the local analog of a seeded release — while its current `linkStatus` is not `FAIL`. Effective availability, not a one-time approval, is what earns ongoing ratio relief.
_Avoid_: link uptime, seeding status, alive link

**Eligible Contribution Bytes**:
The staff-approved, 72h-matured contribution bytes that are also effectively available, summed per user to form the **coverage** term that lowers their required ratio. Revocable: bytes leave the pool when a contribution goes `FAIL`.
_Avoid_: contribution credit, ratio bonus, approved bytes

**Contribution Spine**:
The generic `Contribution` model — the type-agnostic unit of shared content (a Download URL) carried across every CommunityType. Holds only fields every Contribution has (ids, `downloadUrl`, `sizeInBytes`, `linkStatus`, the `type` format discriminator, accounting). A Release is the primary Contribution type; Film/eLearning/ApiPlugin follow. Type-specific metadata lives in satellite models, never on the spine (ADR-0008).
_Avoid_: contribution table, base contribution, release row

**Release File**:
The per-file rip-metadata satellite (`ReleaseFile`, 1:1 with a music Contribution): `bitrate`, `hasLog`, `hasCue`, `isScene` — the fingerprint the quality grade reads. Per-file, so distinct from the per-pressing `Edition`. The music analog of the satellite each future Contribution type attaches.
_Avoid_: contribution metadata, file info, rip record

**Ratio Mechanism**:
The standalone `contributed`/`consumed` download gate (required-ratio brackets + the `OK/WATCH/LEECH_DISABLED` policy). Distinct from **RatioScore**. The Ratio Mechanism never reads CRS.
_Avoid_: ratio score, ratio policy (when meaning the whole gate)

**RatioScore**:
A bounded CRS **Dimension Scorer** derived one-way from a user's current ratio health. An input to reputation, never an enforcement lever.
_Avoid_: ratio, required ratio

**Dimension Scorer**:
A bounded, pure function `compute(user) → subScore` contributing one capped term to the Community Reputation Score. Self-registers into the CRS registry.
_Avoid_: metric, plugin, scorer module

**Controlled Vector**:
A bounded cross-dimension CRS edge — one signal nudging another dimension — capped and deduplicated to resist farming (e.g. stylesheet adoption feeding the Friends dimension).
_Avoid_: cross-score, bonus link, coupling

**Release-Announce Feed**:
The out-of-band stream of new Contributions delivered to a member over RSS/XML and IRC — the firehose of the Contribution Spine as it grows. Authenticated by the **AnnounceKey**, not the **Identity State** (the member is not carrying a session cookie on these channels). Distinct from consuming a release, which stays a session-authed accounted download.
_Avoid_: rss feed, announce stream, the firehose

**AnnounceKey**:
A per-user credential authenticating a member's **Release-Announce Feed** (RSS + IRC announce). It gates _receiving_ the stream of new Contributions; it never authenticates a download — release consumption remains a session-authed grant through the **Ratio Mechanism**. Rotatable; rotating it invalidates the prior feed URL.
_Avoid_: passkey, download key, torrent key

**IRCKey**:
A per-user credential authenticating a member's **identity on the IRC network** (presented as the SASL secret to the IRCd, validated against this API). Paired with the **AnnounceKey** it enables personalized release announcements pushed over IRC; alone it only establishes who a nick is. Distinct from the AnnounceKey — different channel, different rotation/threat model.
_Avoid_: irc password, chat token, drone key

**IRCScore**:
A bounded CRS **Dimension Scorer** derived from a member's _message_ activity on IRC over a trailing window — message volume weighted by channel and scaled by how many distinct days they were active. Presence/idle never contributes (anti-farming); only messages count. Capped with diminishing returns like every dimension, so IRC cannot dominate reputation.
_Avoid_: irc activity, chat score, presence score

**IRC Activity Rollup**:
The durable, pre-aggregated substrate **IRCScore** reads — one row per member × channel × day of message counts, upserted by the IRC bot. The append/aggregate surface ADR-0007 calls for when a signal is _irreducible_ (not reconstructable from current state) yet too high-volume for the `CRS_*` event ledger. The score is still computed on read over a trailing window of these rows; nothing stores a denormalized IRCScore.
_Avoid_: irc log, activity table, message history

**Verified IRC Link**:
A _proven_ binding between a Stellar account and an IRC nick — the only state that credits **IRCScore** or resolves through the korin nick→account lookup. Established by **Nick Verification**, not self-assertion (ADR-0015). An unproven assertion is a **Nick Claim** and carries no weight.
_Avoid_: nick mapping, IRC account, IRC identity

**Nick Claim**:
A member's asserted-but-unproven IRC nick plus its pending verification state (the **Verification Code** and its expiry). Reserves nothing — multiple members may hold a Nick Claim on the same nick at once; whoever completes **Nick Verification** first wins the binding (the **Verified IRC Link**). Only a verified nick occupies the unique slot.
_Avoid_: pending nick, unverified link, nick reservation

**Verification Code**:
The single-use, time-boxed (30 min) code issued for a **Nick Claim**, proven by sending it _from the claimed nick_ in a private query to the bridge bot. Confidentiality is hygiene, not the boundary — the `(fromNick, code)` pairing is what makes a leaked code useless to anyone who doesn't control the nick.
_Avoid_: nonce, token, **key**, passcode

**Nick Verification**:
The handshake that turns a **Nick Claim** into a **Verified IRC Link** by proving control of the claimed nick. Its security rests on the `(fromNick, code)` binding plus Ergo's `force-nick-equals-account` — only the nick's true owner can present the code as that nick. Distinct from the superseded delegated-SASL design (ADR-0011).
_Avoid_: SASL auth, delegated auth, login

**Chrome Layer**:
The high-priority CSS `@layer` / `all: revert` boundary that renders critical app chrome (navigation, staff/admin and moderation controls) so an injected user stylesheet cannot override or hide it. The isolation half of the stylesheet trust boundary; user themes cascade everywhere else, and a store-time sanitizer + inject-time CSP cover the exfiltration half (ADR-0003).
_Avoid_: sandbox, shadow root, reset wrapper

**Standing**:
A member's five-rung governance tier — `pristine | clean | neutral | poor | hammer` — computed on read from active **Warnings**, ban state, and account tenure (never a stored column). It _scales_ rule impact on the CRS (pristine amplifies compliance rewards, hammer amplifies violation penalties); it is not a **Dimension Scorer** and never gates access (ADR-0004).
_Avoid_: reputation tier, warning level, standing score, rank

**Contagion**:
The invite-tree suspicion that flows from an infected _trunk_ (a banned or ban-evading inviter) down to its _branches_ (the invitees). A **graded**, distance-decaying signal — suspect, not condemned — owned by the InviteTree. Distinct from a member's own **confirmed** ban-evasion, which alone reaches the terminal `hammer` **Standing**.
_Avoid_: tree poisoning, ban inheritance, guilt by association

**CommunityScore**:
A _deferred_ (#75) CRS **Dimension Scorer** that folds a Community's read-time health pulse (`getCommunityHealthPulse`, ADR-0002) into a member's **single, global** Community Reputation Score. It is **not** a separate per-community reputation: a member has one CRS; "their CommunityScore _for_ a Community" is that community's health contributing one capped term to it. No parallel per-community score exists. The pulse is now also **persisted** over time (see **Community Health Snapshot**), which is the trend substrate this fold will read — but the dimension itself is still unbuilt (#75).
_Avoid_: community reputation, per-community CRS, community ranking

**Community Health Snapshot**:
A persisted time-series point of a Community's link-health pulse (`CommunityHealthSnapshot`: counts + `coverage`/`pulse`/`status`, per community × `StatSnapshotPeriod` × bucket), captured by the stats job at Daily/Monthly/Yearly cadence and read at `GET /api/communities/:id/health/history`. The live `getCommunityHealthPulse` and the snapshot share one banding via `computePulse` (`linkHealth.ts`); the snapshot stores the band **as computed at capture time**. It is a derived trend layer, never the source of truth (ADR-0007).
_Avoid_: stored health score, community health table, denormalized pulse

**Site Theme**:
A built-in, admin-managed stylesheet (`Stylesheet` model: `Sublime`/Default + alternatives, referenced by `cssUrl`, one flagged `isDefault`). The base layer of the cascade, applied site-wide until a member or page context selects something else. Authored by staff/SysOps, not members.
_Avoid_: default css, base skin, system stylesheet

**Authored Stylesheet**:
A `.scss`/`.css` theme written by a member — the **StylesheetAuthor** (shorthand for any User who has authored one, not a distinct role/entity). Stored as `source`, sanitized at store-time (ADR-0003) so the persisted artifact is safe; the UI injector + CSP add the inject-time half. A member may author several. Distinct from a **Site Theme** (built-in) and from the **slots** a stylesheet is placed into.
_Avoid_: user theme, custom css, skin

**Stylesheet Slot**:
One of three single-valued placements a stylesheet occupies, chosen by **page context**, not a global toggle: the **Profile Stylesheet** (set by a profile's owner; rendered to any visitor on _that_ profile), the **Site Stylesheet** (set by the viewer; rendered on the general site, falling back to the **Site Theme**/Default when unset), and the **Community Stylesheet** (set by a Community's Staff; rendered to anyone on _that_ community's pages). Page context wins: a profile or community page shows its own slot to every viewer regardless of the viewer's Site Stylesheet.
_Avoid_: active stylesheet, theme preference, selected skin

**Stylesheet Adoption**:
A viewer setting their **Site Stylesheet** slot to another member's **Authored Stylesheet** — the scoring event that credits the author's CRS (stylesheet dimension) and fires the Friends **Controlled Vector**. Deduplicated **once per distinct (adopter, author) pair** in the `CRS_*` event ledger (ADR-0007); self-adoption (using your own sheet) renders but earns the author nothing (anti-farm). Site-wide, so the accrual is a global-CRS event — it carries no `communityId`.
_Avoid_: applying a theme, selecting a stylesheet, using a skin

## Relationships

- A **Contract Schema** directly structures incoming inputs and dictates the programmatic generation of the schema served by `swagger-ui-express`.
- An **Identity State** acts as an authorized gateway, validating if a request can access or mutate a specific database record via the **Data Client**.
- **Sanitized Values** must be extracted at the Controller layer using **Contract Schemas** before execution by domain services.
- The **Ratio Mechanism** reads **Eligible Contribution Bytes** (gated by **Effective Availability**) and never reads CRS; a derived **RatioScore** flows one-way into CRS as one **Dimension Scorer**. CRS never gates downloads.
- A **Contribution Spine** carries type-agnostic fields only; a music Contribution attaches a **Release File** (per-file) and an **Edition** (per-pressing). Future CommunityTypes attach their own analogous satellites rather than forking the spine (ADR-0008).
- The **AnnounceKey** authenticates the **Release-Announce Feed** (RSS + IRC) and the **IRCKey** authenticates IRC identity; the two paired enable IRC-delivered release announcements. Neither replaces the **Identity State** on the session-authed download path — they authenticate out-of-band channels only, never a download.
- **Standing** is computed on read from **Warnings** / ban state / tenure and _scales_ rule impact on the CRS via `ruleImpact`; it is never a **Dimension Scorer** and never gates access (enforcement stays granular permissions). A member's own **confirmed** ban-evasion feeds the terminal `hammer` rung, whereas invite-tree **Contagion** feeds only a graded suspicion — suspect is not condemned.

## Flagged Ambiguities

- **"Token Location"** was confusingly structured -- resolved: authentication accepts authorization header bearer tokens or implicit secure `cookie-parser` keys.
- **"Testing Data"** was causing conflicts -- resolved: unit tests utilize mock layers via `jest-mock-extended` and run in parallel via `maxWorkers: 50%`; integration routines strictly target the temporary **Integration Database** and run sequentially (`--runInBand`) to prevent concurrent DB writes.

## Repository Execution Guardrails

### 1. Database Operations & Lifecycles

- Any database state modification requires structural validation against its respective schema layer.
- Schema changes require pushing changes locally using `npm run db:migrate` and running code generation via `npm run db:generate`.
- Seed mock data exclusively through the localized engine script `npm run db:seed`.

### 2. Contract Schemas & Documentation (Zod to OpenAPI)

- Every public route path must bind directly to an registry mapping from `@asteasolutions/zod-to-openapi`.
- Never write standard YAML or JSON files for Swagger UI manually. Run `npm run openapi:export` to generate definitions straight from the application runtime source code.

```typescript
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

export const registry = new OpenAPIRegistry();
const RegisterBody = registry.register(
  'RegisterBody',
  z.object({
    username: z.string().min(1).max(32),
    email: z.string().email(),
    password: z.string().min(6),
    inviteKey: z.string().optional()
  })
);
```

### 3. Error Control & Telemtry Pipeline

- Operational exceptions must route directly out of controller scopes into Express middleware handlers to be serialized for the client.
- System crashes and unhandled exceptions are captured simultaneously across Winston data streams and remote Sentry scopes.

## AI Assistant Instructions

When generating, modifying, or refactoring code within this project, adhere strictly to these engineering constraints:

- **Strict Imports**: Ensure typing definitions capture global context parameters without fallback loops to typing defaults.
- **Sanitization Paths**: Ensure all text fields incoming from dynamic payloads go through the application string purification routine prior to persistence actions.
- **Test Isolation**: Do not pollute parallel test pipelines; write explicit test isolation using jest-mock-extended wrappers when writing atomic units.
