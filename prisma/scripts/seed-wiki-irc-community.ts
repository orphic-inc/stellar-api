/**
 * Seed the wiki with korin.pink IRC community pages.
 *
 * Pages are sourced from korin-pink/wiki/docs/irc/ and represent the
 * community knowledge base for the Stellar IRC integration (ADR-0005).
 *
 * Idempotent — uses upsert on slug. Re-running is a no-op for existing pages;
 * new pages in PAGES will be inserted on subsequent runs.
 *
 * Requires an admin user to exist (authorId defaults to 1 — the install admin).
 * Pass a different ID via --admin-id <n> if needed.
 *
 * Run:
 *   npx ts-node prisma/scripts/seed-wiki-irc-community.ts
 *   npx ts-node prisma/scripts/seed-wiki-irc-community.ts --admin-id 2
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Parse --admin-id flag
// ---------------------------------------------------------------------------
const adminIdArg = process.argv.indexOf('--admin-id');
const AUTHOR_ID = adminIdArg !== -1 ? parseInt(process.argv[adminIdArg + 1], 10) : 1;

if (isNaN(AUTHOR_ID) || AUTHOR_ID < 1) {
  console.error('--admin-id must be a positive integer');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Wiki page definitions
// Body is stored as markdown — consistent with what the wiki API accepts.
// The slug must be ≤ 50 chars (db.VarChar(50)).
// ---------------------------------------------------------------------------
interface WikiSeed {
  title: string;
  slug: string;
  body: string;
  minReadLevel?: number;
  minEditLevel?: number;
}

const PAGES: WikiSeed[] = [
  // ─── Introduction ────────────────────────────────────────────────────────
  {
    title: 'korin.pink',
    slug: 'korin-pink',
    body: `# korin.pink

**korin.pink** is the IRC infrastructure for Stellar — a private music community.

This wiki is the community knowledge base: guides for connecting to IRC, understanding how the server works, and community norms.

---

## IRC

korin.pink runs [Ergo](https://ergo.chat/) — a modern IRCv3 server with built-in history, SASL auth, and TLS. No account required to lurk, but registering your nick lets you link it to your Stellar account and earn IRCScore.

- [How to connect](/wiki/irc-connecting)
- [Channel directory](/wiki/irc-channels)
- [Community etiquette](/wiki/irc-etiquette)
- [IRCScore — what it is and how to earn it](/wiki/irc-score)`,
  },

  // ─── IRC Overview ────────────────────────────────────────────────────────
  {
    title: 'IRC',
    slug: 'irc',
    body: `# IRC on korin.pink

korin.pink runs **[Ergo](https://ergo.chat/)** — a modern, self-contained IRCv3 server.

Features active on this server:

- **TLS** on port \`6697\` — plaintext connections are rejected
- **SASL PLAIN** authentication — nick registration is handled server-side
- **Message history** — server-side scrollback via IRCv3 (\`CHATHISTORY\`)
- **Account-tagged messages** — your account name follows you across nick changes
- **Always-on clients** — persistent sessions via Ergo's built-in bouncer

## Quick start

1. [Connect to the server](/wiki/irc-connecting) with a client of your choice
2. Register your nick: \`/MSG NickServ REGISTER <password> <email>\`
3. Join \`#stellar\` and say hi
4. Link your Ergo nick to your Stellar account via \`PUT /api/users/:id/irc-nick\`
5. Watch your [IRCScore](/wiki/irc-score) climb`,
  },

  // ─── Connecting ──────────────────────────────────────────────────────────
  {
    title: 'Connecting to IRC',
    slug: 'irc-connecting',
    body: `# Connecting to korin.pink IRC

## Server details

| Field | Value |
|-------|-------|
| Host  | \`irc.korin.pink\` |
| Port  | \`6697\` |
| TLS   | **required** |
| SASL  | PLAIN |

Plaintext port 6667 is **not available**.

---

## Client setup

### WeeChat

\`\`\`
/server add korin irc.korin.pink/6697 -ssl
/set irc.server.korin.sasl_mechanism PLAIN
/set irc.server.korin.sasl_username YOUR_NICK
/set irc.server.korin.sasl_password YOUR_PASSWORD
/connect korin
\`\`\`

### irssi

\`\`\`
/network add korin
/server add -auto -network korin -ssl -ssl_verify irc.korin.pink 6697
/set -network korin sasl_mechanism plain
/set -network korin sasl_username YOUR_NICK
/set -network korin sasl_password YOUR_PASSWORD
/connect korin
\`\`\`

### Senpai

\`~/.config/senpai/senpai.scfg\`:

\`\`\`
address irc.korin.pink:6697
nick YOUR_NICK
password YOUR_PASSWORD
tls true
\`\`\`

---

## Nick registration

\`\`\`
/MSG NickServ REGISTER <password> <email>
\`\`\`

---

## Linking to your Stellar account

\`\`\`
PUT /api/users/:id/irc-nick
{ "ircNick": "your_nick" }
\`\`\`

Requires a valid Stellar session. The nick must be unique across all Stellar accounts. See [IRCScore](/wiki/irc-score) for details.`,
  },

  // ─── Channels ────────────────────────────────────────────────────────────
  {
    title: 'IRC Channels',
    slug: 'irc-channels',
    body: `# Channel Directory

All channels are on \`irc.korin.pink:6697\` (TLS required).

| Channel       | Purpose                                           |
|---------------|---------------------------------------------------|
| \`#stellar\`    | General — music, community, off-topic             |
| \`#releases\`   | New release discussion and recommendations        |
| \`#tech\`       | Programming, hardware, Linux, audio engineering   |
| \`#audiophile\` | Headphones, DACs, amps, speaker setups            |
| \`#lounge\`     | Slow-paced ambient chat; lower volume             |
| \`#staff\`      | Staff/mod channel — invite only                   |

> \`/LIST\` in your client will show the current live channel list.

---

## Creating channels

Registered users may create channels freely via standard Ergo ChanServ:

\`\`\`
/MSG ChanServ REGISTER #yourchannel
\`\`\``,
  },

  // ─── Etiquette ───────────────────────────────────────────────────────────
  {
    title: 'Community Etiquette',
    slug: 'irc-etiquette',
    body: `# Community Etiquette

IRC is asynchronous. People aren't always at their keyboard. These norms keep things liveable.

---

## The basics

**Don't ask to ask.** Just ask the question directly. Someone who knows will respond when they see it.

**Idle is fine.** Leaving your client connected 24/7 is normal on IRC. No need to announce arrivals or departures.

**No flooding.** Paste large blocks of text to a pastebin (paste.rs, 0x0.st) and share the link.

**Stay on topic (loosely).** \`#stellar\` is general, \`#releases\` is releases, \`#audiophile\` is gear.

**No spam, no bots** without staff approval.

---

## Tone

This is a private community. Being here is a privilege of membership, not a right.

- No harassment, targeted mockery, or pile-ons.
- Disagreements about music, gear, or code are fine. Disagreements about people are not.
- Staff have final say. If you think a decision was wrong, DM a staff member.

---

## Kicks and bans

| Action              | Consequence                              |
|---------------------|------------------------------------------|
| Minor disruption    | Verbal warning in channel                |
| Repeated disruption | Kick, then temporary ban (hours–days)    |
| Serious violation   | Permanent ban + Stellar account review   |`,
  },

  // ─── IRCScore ────────────────────────────────────────────────────────────
  {
    title: 'IRCScore',
    slug: 'irc-score',
    body: `# IRCScore

IRCScore is a dimension of the **Community Reputation Score (CRS)** in Stellar. It measures how active and consistent you are on korin.pink IRC.

---

## Formula

\`\`\`
IRCScore = activity × consistency × channelQuality   (cap = 6, weight = 1.0)

activity       = log1p(messageCount)   / log1p(50)
consistency    = presenceSeconds / windowDurationSeconds
channelQuality = log1p(channelCount)   / log1p(5)
\`\`\`

All three factors are in \`[0, 1]\`. Their product scales to a cap of 6.

| Factor           | What it measures                              | Saturates at |
|------------------|-----------------------------------------------|--------------|
| \`activity\`       | Messages sent in the flush window (log-scaled) | ~50 msgs    |
| \`consistency\`    | Fraction of the window you were online         | 100% uptime  |
| \`channelQuality\` | Unique channels you were active in (log)       | ~5 channels  |

Log-scaling prevents volume abuse — consistent presence matters more than flooding.

---

## How it's computed

The irc-bridge daemon tracks per-nick: \`presenceMs\`, \`messageCount\`, and \`channels\`. It flushes to the korin API every 60 seconds. Stellar polls every 5 minutes and caches the result. The score reflects the most recent completed flush window.

---

## How to earn IRCScore

1. Register a nick on \`irc.korin.pink\` — see [Connecting](/wiki/irc-connecting)
2. Link it to your Stellar account via \`PUT /api/users/:id/irc-nick\`
3. Show up. Consistent presence matters more than message volume.

Absence of a linked IRC nick earns 0 — it doesn't penalise other CRS dimensions.

---

## Nick linking API

\`\`\`
PUT /api/users/:id/irc-nick
Content-Type: application/json

{ "ircNick": "your_nick" }
\`\`\`

- Only one Stellar account per nick. Conflicts return \`409 Conflict\`.
- To unlink: \`{ "ircNick": null }\`
- Admins can update any user; regular users can only update themselves.`,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Seeding wiki with ${PAGES.length} IRC community pages (authorId=${AUTHOR_ID})...`);

  // Verify author exists
  const author = await prisma.user.findUnique({ where: { id: AUTHOR_ID } });
  if (!author) {
    console.error(`No user found with id=${AUTHOR_ID}. Run the install flow first or pass --admin-id.`);
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const page of PAGES) {
    const existing = await prisma.wikiPage.findUnique({ where: { slug: page.slug } });

    if (existing) {
      console.log(`  skip  ${page.slug} (already exists as id=${existing.id})`);
      skipped++;
      continue;
    }

    const created_page = await prisma.wikiPage.create({
      data: {
        title: page.title,
        slug: page.slug,
        body: page.body,
        revision: 1,
        minReadLevel: page.minReadLevel ?? 0,
        minEditLevel: page.minEditLevel ?? 0,
        authorId: AUTHOR_ID,
      },
    });

    console.log(`  create ${page.slug} → id=${created_page.id}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, skipped: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
