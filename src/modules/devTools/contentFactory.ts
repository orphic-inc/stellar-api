/**
 * devTools/contentFactory.ts
 *
 * Pre-defined realistic data pools and content generators.
 * Derived from sample data files (releases, collages, wiki, tags).
 * No runtime dependencies — deterministic given a SeedContext.
 */

import {
  pick,
  pickN,
  randInt,
  randBool,
  SeedContext,
  daysAgo
} from './seedRandom';

// ─── Artist & Album Name Pools ────────────────────────────────────────────────

const ARTIST_ADJECTIVES = [
  'Dark',
  'Electric',
  'Silent',
  'Broken',
  'Hollow',
  'Pale',
  'Iron',
  'Ember',
  'Distant',
  'Frozen',
  'Velvet',
  'Crimson',
  'Shadow',
  'Golden',
  'Midnight',
  'Burning',
  'Fading',
  'Steel',
  'Azure',
  'Ancient',
  'Crystal',
  'Neon',
  'Obsidian',
  'Cerulean'
];

const ARTIST_NOUNS = [
  'Coast',
  'Nova',
  'Echo',
  'Mirror',
  'Star',
  'Wave',
  'Drift',
  'Tide',
  'Ruin',
  'Signal',
  'Pulse',
  'Canyon',
  'Harbor',
  'Circuit',
  'Garden',
  'Tower',
  'Archive',
  'Ascent',
  'Fault',
  'Basin',
  'Chorus',
  'Anthem',
  'Vessel',
  'Current',
  'Meridian',
  'Horizon'
];

const SOLO_PREFIXES = [
  'Kid',
  'Young',
  'Old',
  'Little',
  'Big',
  'DJ',
  'MC',
  'Sir',
  'Lady'
];

const SOLO_NAMES = [
  'Capri',
  'Reeves',
  'Vance',
  'Monroe',
  'Sterling',
  'Cross',
  'Vale',
  'Quinn',
  'Rhodes',
  'Ashton',
  'Finch',
  'Mercer',
  'Lane',
  'Hawk',
  'Drake',
  'Stone',
  'Fox',
  'Cole',
  'Reed'
];

const THE_BANDS = [
  'Fading Coast',
  'Iron Echo',
  'Pale Meridian',
  'Hollow Signal',
  'Burning Archive',
  'Crystal Tide',
  'Shadow Circuit',
  'Distant Nova',
  'Velvet Basin',
  'Midnight Chorus',
  'Neon Fault',
  'Silent Tower',
  'Golden Vessel',
  'Dark Harbor',
  'Electric Garden'
];

export function makeArtistName(ctx: SeedContext): string {
  const roll = ctx.next();
  if (roll < 0.35) {
    return `${pick(ARTIST_ADJECTIVES, ctx)} ${pick(ARTIST_NOUNS, ctx)}`;
  } else if (roll < 0.55) {
    return `The ${pick(THE_BANDS, ctx)}`;
  } else if (roll < 0.75) {
    return `${pick(SOLO_PREFIXES, ctx)} ${pick(SOLO_NAMES, ctx)}`;
  } else {
    return pick(SOLO_NAMES, ctx);
  }
}

// ─── Album Title Pools ────────────────────────────────────────────────────────

const ALBUM_OPENERS = [
  'Finding',
  'Echoes of',
  'Return to',
  'Last Light of',
  'Into the',
  'Beyond the',
  'Above the',
  'After',
  'Before',
  'Toward',
  'Against'
];

const ALBUM_NOUNS = [
  'Forever',
  'Idlewild',
  'Parallel Lines',
  'Purity',
  'Fracture',
  'Revival',
  'Overture',
  'Daylight',
  'Neon Wilderness',
  'Ruins',
  'The Long Way',
  'Cascade',
  'Signal Loss',
  'Drift Season',
  'Undertow',
  'Slow Burn',
  'Periphery',
  'The Still Hours',
  'Monuments',
  'Fault Lines',
  'Quiet Machinery',
  'Hollows',
  'Resonance',
  'The Long Dark',
  'Static',
  'Convergence',
  'Archipelago',
  'Terminal',
  'Interiors',
  'Midwinter'
];

export function makeAlbumTitle(ctx: SeedContext): string {
  if (randBool(0.5, ctx)) {
    return pick(ALBUM_NOUNS, ctx);
  }
  return `${pick(ALBUM_OPENERS, ctx)} ${pick(ALBUM_NOUNS, ctx)}`;
}

// ─── Record Labels & Catalogue Numbers ───────────────────────────────────────

const RECORD_LABELS = [
  'Uxicon Records',
  'LaFace',
  'Geffen',
  'Warp',
  'Sub Pop',
  'Ninja Tune',
  'Domino',
  'Merge',
  'Secretly Canadian',
  'Matador',
  '4AD',
  'Epitaph',
  'Dischord',
  'Touch and Go',
  'XL Recordings',
  'Rough Trade',
  'Kranky',
  'Constellation',
  'Temporary Residence',
  'No Quarter',
  'Dead Oceans',
  'Jagjaguwar',
  'Thrill Jockey'
];

const CATALOGUE_PREFIXES = [
  'UX',
  'LAF',
  'GEF',
  'WRP',
  'SP',
  'NT',
  'DOM',
  'MRG',
  'SC',
  'MAT',
  '4AD',
  'EPT',
  'XL',
  'RT',
  'KNK',
  'CST'
];

export function makeRecordLabel(ctx: SeedContext): string {
  return pick(RECORD_LABELS, ctx);
}

export function makeCatalogueNumber(ctx: SeedContext): string {
  const prefix = pick(CATALOGUE_PREFIXES, ctx);
  const num = randInt(100, 9999, ctx);
  return `${prefix}-${num}`;
}

// ─── Tag Pools ────────────────────────────────────────────────────────────────

/**
 * Real tag names from the platform's tag sample data.
 * In isolated mode these are prefixed with "seed." to avoid
 * touching existing tag rows.
 */
export const GENRE_TAGS = [
  'rock',
  'electronic',
  'hip.hop',
  'jazz',
  'metal',
  'pop',
  'folk',
  'classical',
  'ambient',
  'punk',
  'soul',
  'funk',
  'reggae',
  'alternative',
  'indie',
  'experimental',
  'post.rock',
  'progressive.rock',
  'death.metal',
  'black.metal',
  'drone',
  'shoegaze',
  'dream.pop',
  'noise.rock',
  'doom.metal',
  'stoner.rock',
  'math.rock',
  'emo',
  'hardcore',
  'grunge',
  'synth.pop',
  'new.wave',
  'darkwave',
  'industrial',
  'trip.hop',
  'drum.and.bass',
  'house',
  'techno',
  'minimal',
  'idm',
  'glitch',
  'field.recording',
  'contemporary.classical',
  'krautrock'
];

export const ERA_TAGS = [
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s'
];

export const DESCRIPTOR_TAGS = [
  'instrumental',
  'vocal',
  'remix',
  'live',
  'acoustic',
  'electric',
  'lo.fi',
  'hi.fi',
  'studio',
  'bootleg',
  'reissue',
  'compilation',
  'ep',
  'single',
  'split',
  'collaborative'
];

export function makeTagSet(
  ctx: SeedContext,
  isolated: boolean,
  count?: number
): string[] {
  const n = count ?? randInt(2, 6, ctx);
  const genreCount = Math.max(1, randInt(1, Math.min(n, 3), ctx));
  const genres = pickN(GENRE_TAGS, genreCount, ctx);
  const extras: string[] = [];

  if (randBool(0.6, ctx)) extras.push(pick(ERA_TAGS, ctx));
  if (randBool(0.3, ctx)) extras.push(pick(DESCRIPTOR_TAGS, ctx));

  const all = [...genres, ...extras].slice(0, n);

  if (isolated) {
    return all.map((t) => `seed.${t}`);
  }
  return all;
}

// ─── Username Generation ──────────────────────────────────────────────────────

const USERNAME_WORDS_A = [
  'aurora',
  'drift',
  'echo',
  'ember',
  'frost',
  'harbor',
  'hollow',
  'iron',
  'jade',
  'lunar',
  'marble',
  'nebula',
  'onyx',
  'opal',
  'peak',
  'prism',
  'ridge',
  'rune',
  'sage',
  'solar',
  'stone',
  'swift',
  'terra',
  'tide',
  'thorn',
  'vale',
  'vapor',
  'wave'
];

const USERNAME_WORDS_B = [
  'bay',
  'bloom',
  'bright',
  'burn',
  'cliff',
  'creek',
  'crest',
  'dale',
  'den',
  'depth',
  'dusk',
  'fall',
  'field',
  'gate',
  'glade',
  'glen',
  'grove',
  'hill',
  'hollow',
  'keep',
  'lake',
  'light',
  'marsh',
  'mist',
  'moon',
  'moor',
  'peak',
  'plain',
  'reef',
  'rift',
  'rise',
  'rock',
  'shore',
  'sky',
  'star',
  'storm'
];

/** Generated usernames — unique by index; @seed.invalid email is the safety net */
export function makeUsername(index: number, ctx: SeedContext): string {
  const a = pick(USERNAME_WORDS_A, ctx);
  const b = pick(USERNAME_WORDS_B, ctx);
  // Include the index to guarantee uniqueness even if words collide
  return `${a}_${b}${index}`;
}

/** All generated user emails use the reserved @seed.invalid TLD */
export function makeSeedEmail(username: string): string {
  return `${username}@seed.invalid`;
}

// ─── BBCode Content Generators ────────────────────────────────────────────────

const WIKI_TOPICS = [
  'Transcoding',
  'Bitrate',
  'Lossless Audio',
  'Log Files',
  'ReplayGain',
  'Tagging Standards',
  'File Formats',
  'Audio Encoding',
  'Spectral Analysis',
  'Community Guidelines',
  'Contribution Rules',
  'Metadata Standards',
  'Lossy vs Lossless',
  'FLAC Format',
  'MP3 Encoding',
  'Vinyl Ripping',
  'CD Ripping',
  'Cue Sheets',
  'Scene Rules',
  'Source Verification'
];

const WIKI_INTRO_SENTENCES = [
  'This page documents the standards and practices for {topic} within this community.',
  'The following guide covers everything you need to know about {topic}.',
  '{topic} is an important concept for contributors and consumers alike.',
  'Understanding {topic} is essential for maintaining quality standards.',
  'This article provides a comprehensive overview of {topic}.'
];

const WIKI_SECTIONS = [
  ['Overview', 'Background', 'Introduction'],
  ['Requirements', 'Standards', 'Criteria', 'Rules'],
  ['Examples', 'Common Cases', 'Use Cases'],
  ['FAQ', 'Common Questions', 'Troubleshooting'],
  ['See Also', 'Related Topics', 'Further Reading']
];

const WIKI_BODY_FRAGMENTS = [
  'When contributing, always ensure that your files meet the minimum quality requirements.',
  'Contributors are responsible for verifying the accuracy of all metadata.',
  'The use of automated tools is permitted, but manual verification is recommended.',
  'File naming conventions should follow the established community standards.',
  'Tags must be accurate and complete; incorrect tags should be reported.',
  'Bitrate requirements vary by format. Lossless formats are always preferred.',
  'Log files provide a record of the ripping process and should be included where applicable.',
  'Scene releases must be verified against the original scene NFO before upload.',
  'Duplicate releases should be reported using the appropriate report category.',
  'Cover art should be high resolution (minimum 500×500 pixels) and correctly cropped.'
];

export function makeBBCodeWikiPage(ctx: SeedContext): string {
  const topic = pick(WIKI_TOPICS, ctx);
  const intro = pick(WIKI_INTRO_SENTENCES, ctx).replace('{topic}', topic);
  const sectionNames = WIKI_SECTIONS.map((s) => pick(s, ctx));

  let body = `${intro}\n\n`;

  // Section 1: Overview
  body += `==[b]${sectionNames[0]}[/b]==\n\n`;
  const overviewLines = randInt(2, 4, ctx);
  for (let i = 0; i < overviewLines; i++) {
    body += `${pick(WIKI_BODY_FRAGMENTS, ctx)}\n\n`;
  }

  // Section 2: Requirements/Rules (bulleted list)
  body += `==[b]${sectionNames[1]}[/b]==\n\n`;
  body += '[list]\n';
  const ruleCount = randInt(3, 6, ctx);
  for (let i = 0; i < ruleCount; i++) {
    body += `[*]${pick(WIKI_BODY_FRAGMENTS, ctx)}\n`;
  }
  body += '[/list]\n\n';

  // Section 3: Examples
  body += `==[b]${sectionNames[2]}[/b]==\n\n`;
  body += `[b]Example 1:[/b] ${pick(WIKI_BODY_FRAGMENTS, ctx)}\n\n`;
  if (randBool(0.5, ctx)) {
    body += '[code]\n';
    body += `Artist - Album Title (Year) [Format]\n`;
    body += `├── 01 - Track One.flac\n`;
    body += `├── 02 - Track Two.flac\n`;
    body += `└── cover.jpg\n`;
    body += '[/code]\n\n';
  }

  // Section 4: FAQ (optional)
  if (randBool(0.6, ctx)) {
    body += `==[b]${sectionNames[3]}[/b]==\n\n`;
    body += `[b]Q:[/b] ${pick(WIKI_BODY_FRAGMENTS, ctx)}\n`;
    body += `[b]A:[/b] ${pick(WIKI_BODY_FRAGMENTS, ctx)}\n\n`;
  }

  // Section 5: See Also
  body += `==[b]${sectionNames[4]}[/b]==\n\n`;
  body += `[url=https://seed.invalid/wiki]Related Wiki Page[/url]\n`;

  return body;
}

const FORUM_OPENERS = [
  'I wanted to share my thoughts on',
  'Has anyone else noticed',
  'Quick question about',
  'Looking for help with',
  'Just discovered',
  'Can someone explain',
  'Thoughts on',
  'Discussion thread for',
  'I have an issue with',
  'New here and wondering about'
];

const FORUM_TOPICS_POOL = [
  'the recent changes to contribution guidelines',
  'the best approach for ripping vinyl records',
  'identifying transcodes in submitted files',
  'community etiquette and best practices',
  'the new tagging system',
  'recommended tools for audio processing',
  'handling duplicate releases',
  'sourcing hi-res cover art',
  'using spectral analysis for quality checking',
  'the request system and bounty mechanics',
  'account ratio and its implications',
  'recommended listening for newcomers',
  'staff announcements and policy updates',
  'the collage system and how to use it',
  'organizing and categorizing your bookmarks'
];

const FORUM_BODY_SENTENCES = [
  'After spending some time looking into this, I think the best approach is to start with the fundamentals.',
  'The community has traditionally handled this by following established conventions.',
  'I found a great resource that explains this in detail.',
  'This has been discussed before, but I think it deserves another look.',
  'My experience with this suggests that there are several valid approaches.',
  'The documentation covers this, but the practical application can be tricky.',
  'I appreciate any feedback from more experienced members.',
  'This is something I have been thinking about for a while.',
  'The short answer is yes, but the longer explanation is more nuanced.',
  'Hopefully this helps others who might be in a similar situation.'
];

export function makeBBCodeForumPost(
  ctx: SeedContext,
  quoteUsername?: string,
  quoteBody?: string
): string {
  let body = '';

  // Optional quote
  if (quoteUsername && quoteBody && randBool(0.4, ctx)) {
    const quotedLines = quoteBody.split('\n').slice(0, 3).join('\n');
    body += `[quote=${quoteUsername}]${quotedLines}[/quote]\n\n`;
  }

  // Body paragraphs
  const paragraphs = randInt(1, 3, ctx);
  for (let i = 0; i < paragraphs; i++) {
    const sentences = randInt(1, 3, ctx);
    const paragraph = Array.from({ length: sentences }, () =>
      pick(FORUM_BODY_SENTENCES, ctx)
    ).join(' ');
    body += `${paragraph}\n\n`;
  }

  // Optional list
  if (randBool(0.25, ctx)) {
    body += '[list]\n';
    const items = randInt(2, 4, ctx);
    for (let i = 0; i < items; i++) {
      body += `[*]${pick(FORUM_BODY_SENTENCES, ctx)}\n`;
    }
    body += '[/list]\n\n';
  }

  // Optional emphasis
  if (randBool(0.2, ctx)) {
    body += `[b]Note:[/b] ${pick(FORUM_BODY_SENTENCES, ctx)}\n`;
  }

  return body.trim();
}

export function makeForumTopicTitle(ctx: SeedContext): string {
  return `${pick(FORUM_OPENERS, ctx)} ${pick(FORUM_TOPICS_POOL, ctx)}`;
}

// ─── Profile / Bio Generator ──────────────────────────────────────────────────

const BIO_LINES = [
  'Been a member of this community for a while now.',
  'Passionate about audio quality and music discovery.',
  'Primarily interested in [b]jazz[/b] and [b]electronic[/b] music.',
  'Contributing what I can to keep the collection growing.',
  'Always looking for rare recordings and obscure releases.',
  'Hi-fi enthusiast with a large vinyl collection.',
  'Prefer lossless formats but appreciate any quality contribution.',
  'Happy to help with tagging and metadata corrections.',
  'Long-time lurker, occasional contributor.',
  'Music is life. Thanks to everyone who keeps this place running.'
];

export function makeBBCodeProfile(ctx: SeedContext): string {
  const lineCount = randInt(1, 4, ctx);
  const lines = Array.from({ length: lineCount }, () => pick(BIO_LINES, ctx));
  return lines.join('\n\n');
}

// ─── Release Description ──────────────────────────────────────────────────────

const RELEASE_DESC_OPENERS = [
  'A critically acclaimed record',
  'An influential album',
  'A landmark release',
  'A cult classic',
  'A genre-defining work',
  'A deeply personal record',
  'An ambitious and sprawling effort',
  'A stripped-down, intimate recording',
  'A collaborative effort between',
  'The debut release from'
];

const RELEASE_DESC_MIDDLES = [
  'that pushed the boundaries of the genre.',
  'that remains as relevant today as when it was first released.',
  'celebrated for its intricate arrangements and memorable hooks.',
  'that blends influences from across the musical spectrum.',
  "that marked a significant turning point in the artist's career.",
  'known for its experimental approach and unconventional structure.',
  'praised by critics for its emotional depth and sonic richness.',
  'that divided critics but found a devoted fanbase over time.',
  'widely regarded as a masterpiece of its era.',
  "that introduced a new generation of listeners to the artist's work."
];

export function makeReleaseDescription(ctx: SeedContext): string {
  const opener = pick(RELEASE_DESC_OPENERS, ctx);
  const middle = pick(RELEASE_DESC_MIDDLES, ctx);
  return `${opener} ${middle}`;
}

// ─── Community Description ────────────────────────────────────────────────────

const COMMUNITY_DESC_TEMPLATES = [
  'A community dedicated to {genre} music. All quality contributions welcome.',
  'The primary hub for {genre} releases on this platform.',
  '{genre} enthusiasts welcome. Please read the rules before contributing.',
  'High-quality {genre} releases only. See the wiki for formatting requirements.',
  'A growing collection of {genre} recordings from across the decades.'
];

const COMMUNITY_GENRES = [
  'rock and roll',
  'jazz',
  'electronic',
  'hip-hop',
  'classical',
  'folk',
  'ambient',
  'metal',
  'punk',
  'experimental',
  'indie',
  'soul and R&B',
  'world music',
  'audio book',
  'comedy and spoken word'
];

export function makeCommunityDescription(ctx: SeedContext): string {
  const template = pick(COMMUNITY_DESC_TEMPLATES, ctx);
  const genre = pick(COMMUNITY_GENRES, ctx);
  return template.replace('{genre}', genre);
}

// ─── Community Name ───────────────────────────────────────────────────────────

const COMMUNITY_NAME_PATTERNS = [
  '{Genre} Vault',
  '{Genre} Archive',
  'The {Genre} Library',
  '{Genre} Repository',
  '{Genre} Collection',
  '{Genre} Hub',
  'Sound of {Genre}',
  'Pure {Genre}',
  '{Genre} Central',
  '{Genre} Lossless'
];

const COMMUNITY_GENRES_CAPITALIZED = [
  'Rock',
  'Jazz',
  'Electronic',
  'Hip-Hop',
  'Classical',
  'Folk',
  'Ambient',
  'Metal',
  'Punk',
  'Experimental',
  'Indie',
  'Soul',
  'World Music',
  'Audiobook',
  'Comedy'
];

export function makeCommunityName(index: number, ctx: SeedContext): string {
  const pattern = pick(COMMUNITY_NAME_PATTERNS, ctx);
  const genre = pick(COMMUNITY_GENRES_CAPITALIZED, ctx);
  const name = pattern.replace('{Genre}', genre);
  // Append index to prevent unique constraint violations
  return `${name} ${index}`;
}

// ─── Collage Name ─────────────────────────────────────────────────────────────

const COLLAGE_NAME_TEMPLATES = [
  'Best of {Year}',
  '{Pub}: Albums of the Year',
  'Staff Picks — {Season}',
  'Essential {Genre} Listening',
  'Hidden Gems: {Genre}',
  '{Pub} 500 Greatest Albums',
  'Newcomer Recommendations {Year}',
  "Members' Favorites: {Season} Edition",
  '{Genre} Starter Pack',
  'Year-End Wrap-Up {Year}'
];

const PUBLICATIONS = [
  'Pitchfork',
  'Mojo',
  'NME',
  'Wire',
  'Uncut',
  'AllMusic',
  'Rolling Stone',
  'The Wire',
  'Resident Advisor'
];

const SEASONS = [
  'Spring',
  'Summer',
  'Autumn',
  'Winter',
  'Q1',
  'Q2',
  'Q3',
  'Q4'
];

export function makeCollageName(index: number, ctx: SeedContext): string {
  const template = pick(COLLAGE_NAME_TEMPLATES, ctx);
  const year = randInt(2018, 2025, ctx);
  const pub = pick(PUBLICATIONS, ctx);
  const season = pick(SEASONS, ctx);
  const genre = pick(COMMUNITY_GENRES_CAPITALIZED, ctx);
  return template
    .replace('{Year}', String(year))
    .replace('{Pub}', pub)
    .replace('{Season}', season)
    .replace('{Genre}', genre)
    .concat(` #${index}`);
}

// ─── Request Title ────────────────────────────────────────────────────────────

export function makeRequestTitle(artistName: string, ctx: SeedContext): string {
  const patterns = [
    `${artistName} - ${makeAlbumTitle(ctx)}`,
    `${artistName} — Complete Discography`,
    `${artistName} — Live Recording`,
    `${artistName} - ${makeAlbumTitle(ctx)} [Lossless]`,
    `${artistName} — Rare Singles Collection`
  ];
  return pick(patterns, ctx);
}

// ─── Wiki Page Title & Slug ───────────────────────────────────────────────────

export function makeWikiTitle(index: number, ctx: SeedContext): string {
  const topic = pick(WIKI_TOPICS, ctx);
  return `${topic} Guide ${index}`;
}

export function makeWikiSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

// ─── Report Reason ────────────────────────────────────────────────────────────

const REPORT_REASONS = [
  'This appears to be a low-bitrate transcode masquerading as a lossless file.',
  'Duplicate release — an identical torrent was uploaded last month.',
  'Missing tracks: this release is incomplete according to the official tracklist.',
  'Incorrect tags: artist name and album title are swapped.',
  'Scene release without proper source verification.',
  'Cover art is missing or has incorrect dimensions.',
  'Bitrate does not match the specified format.',
  'This user has been repeatedly violating community guidelines.',
  'The forum post contains off-topic content unrelated to the community.',
  'Comment contains harassment directed at another member.',
  'Collage description is inaccurate and misleading.',
  'Request has already been filled — closing this duplicate.',
  'This wiki page contains outdated or incorrect information.'
];

export function makeReportReason(ctx: SeedContext): string {
  return pick(REPORT_REASONS, ctx);
}

// ─── Staff Inbox / Ticket ─────────────────────────────────────────────────────

const TICKET_SUBJECTS = [
  'Account access issue',
  'Ratio assistance request',
  'Question about contribution rules',
  'Report follow-up',
  'Invite request',
  'Staff recommendation',
  'Bug report: page not loading',
  'Request to appeal account restriction',
  'Metadata correction request',
  'Question about donor perks'
];

const TICKET_BODIES = [
  'I am having trouble accessing my account after the recent update.',
  'My ratio has dropped below the threshold due to a failed download, can you help?',
  'I am unsure whether a specific release format is allowed under current rules.',
  'I filed a report two weeks ago and have not received a response.',
  'I would like to invite a friend who is interested in contributing.',
  'I would like to recommend a trusted user for a staff position.',
  'The page at /private/releases shows a blank screen after logging in.',
  'I believe my account restriction was applied in error.',
  'There are several metadata errors on a release I cannot edit.',
  'I am a donor but have not received my reward perks yet.'
];

export function makeTicketSubject(ctx: SeedContext): string {
  return pick(TICKET_SUBJECTS, ctx);
}

export function makeTicketBody(ctx: SeedContext): string {
  return pick(TICKET_BODIES, ctx);
}

export function makeStaffReply(ctx: SeedContext): string {
  const replies = [
    'Thank you for reaching out. I have looked into your account and will follow up shortly.',
    'Your request has been noted. I will escalate this to the appropriate team member.',
    'I have reviewed the situation. Please allow 48 hours for this to be resolved.',
    'After reviewing your account, I can confirm there was an error. This has been corrected.',
    'This issue has been logged. You should see the changes reflected within 24 hours.',
    'Thank you for your patience. This matter is now resolved.',
    'I have reviewed the report and agree with your assessment. Action has been taken.'
  ];
  return pick(replies, ctx);
}

// ─── Canned Responses ─────────────────────────────────────────────────────────

export const CANNED_RESPONSES = [
  {
    name: 'Ratio assistance — standard',
    body:
      'Thank you for contacting staff about your ratio. Your account has been reviewed. ' +
      'Please ensure your client is correctly reporting data to avoid future issues.'
  },
  {
    name: 'Account locked — appeal denied',
    body:
      'After reviewing your account history, we have determined that the restriction ' +
      'was applied correctly and will remain in place.'
  },
  {
    name: 'Duplicate report — confirmed',
    body:
      'The release has been confirmed as a duplicate. The older, higher-quality version ' +
      'has been retained. Thank you for reporting this.'
  },
  {
    name: 'Invite request — approved',
    body:
      'Your invite request has been approved. One invite token has been added to your account. ' +
      'Please use it responsibly.'
  },
  {
    name: 'Metadata fix — confirmed',
    body:
      'The metadata error you reported has been corrected. Thank you for helping ' +
      'maintain the quality of our library.'
  },
  {
    name: 'Transcode report — resolved',
    body:
      'The release you reported has been confirmed as a transcode and has been removed. ' +
      'A note has been added to the release group to prevent re-upload.'
  },
  {
    name: 'Generic — issue resolved',
    body:
      'Thank you for your message. The issue you described has been resolved. ' +
      'Please feel free to contact us if you have further questions.'
  }
];

// ─── Site History Entry ───────────────────────────────────────────────────────

const SITE_HISTORY_TITLES = [
  'Updated contribution rules for MP3 format',
  'New wiki pages: Audio Transcoding and Log Verification',
  'Staff team changes — welcome new moderators',
  'Maintenance window completed — performance improvements',
  'Community milestone: 10,000 releases indexed',
  'Policy update: duplicate reporting process revised',
  'New feature: collage subscription notifications',
  'System update: improved search indexing',
  'Forum restructure — new categories added',
  'Staff announcement: ratio watch policy updated'
];

const SITE_HISTORY_BODIES = [
  'Following community feedback, we have updated the guidelines to better reflect current expectations.',
  'After a period of consultation, the staff team has agreed on the following changes.',
  'This update has been in progress for some time and we are pleased to announce its completion.',
  'Thank you to everyone who participated in the discussion and provided feedback.',
  'Full details of the changes can be found in the relevant wiki pages.',
  'If you have questions about these changes, please post in the announcements forum.'
];

export function makeSiteHistoryTitle(ctx: SeedContext): string {
  return pick(SITE_HISTORY_TITLES, ctx);
}

export function makeSiteHistoryBody(ctx: SeedContext): string {
  const count = randInt(1, 3, ctx);
  return Array.from({ length: count }, () =>
    pick(SITE_HISTORY_BODIES, ctx)
  ).join('\n\n');
}

// ─── Global Notice ────────────────────────────────────────────────────────────

const NOTICE_MESSAGES = [
  'Maintenance scheduled for Sunday — brief downtime expected.',
  'Welcome to the new community platform! Report any issues via the staff inbox.',
  'Reminder: updated contribution guidelines are now in effect.',
  'New wiki pages have been added. Check the wiki for the latest documentation.',
  'Site is experiencing slower than usual load times — we are investigating.',
  'Nominations for staff positions are now open.',
  'Year-end statistics are now available on the stats page.'
];

export function makeNoticeMessage(ctx: SeedContext): string {
  return pick(NOTICE_MESSAGES, ctx);
}

// ─── News / Blog Post ─────────────────────────────────────────────────────────

const NEWS_TITLES = [
  'Staff Update: New Moderation Team Members',
  'Site Milestone: 50,000 Contributions',
  'Feature Update: Enhanced Search Filters',
  'Community Survey Results',
  'Infrastructure Upgrade Complete',
  'Annual Donation Drive — Thank You!',
  'Policy Changes: What You Need to Know',
  'New Community: Classical and Contemporary',
  'Maintenance Complete — Performance Improved',
  'Spotlight: Best Contributions of the Month'
];

const NEWS_BODIES = [
  'We are pleased to announce a significant milestone for this platform.',
  'After months of planning, we are excited to share this update with the community.',
  'Thank you to everyone who has contributed to making this possible.',
  'The details are outlined below. Please read carefully before proceeding.',
  'This change has been driven by community feedback and staff deliberation.',
  'Full documentation is available in the wiki.',
  'We appreciate your continued support and engagement with the community.'
];

export function makeNewsTitle(ctx: SeedContext): string {
  return pick(NEWS_TITLES, ctx);
}

export function makeNewsBody(ctx: SeedContext): string {
  const count = randInt(2, 4, ctx);
  return Array.from({ length: count }, () => pick(NEWS_BODIES, ctx)).join(
    '\n\n'
  );
}

// ─── Private Message ─────────────────────────────────────────────────────────

const PM_SUBJECTS = [
  'Hey, quick question',
  'About that release you uploaded',
  'Thanks for the recommendation',
  'Collaboration proposal',
  'Feedback on my contribution',
  'Nice find!',
  'Ratio tip',
  'Following up',
  'Have you heard...',
  'Staff feedback received'
];

const PM_BODIES = [
  'Hey, I noticed your recent contribution and wanted to say excellent work!',
  'I had a question about the release you uploaded last week.',
  'Thanks for the recommendation — I have been listening all week.',
  'Would you be interested in collaborating on a collage?',
  'I received your message — I will get back to you when I have a chance.',
  'Your contribution was flagged but I reviewed it and it looks fine.',
  'Just wanted to reach out and say hello.',
  'I found a rare recording you might be interested in.',
  'Do you know of any good resources for ripping vinyl?',
  'Have you checked the new releases in the jazz community? Some great finds.'
];

export function makePmSubject(ctx: SeedContext): string {
  return pick(PM_SUBJECTS, ctx);
}

export function makePmBody(ctx: SeedContext): string {
  const count = randInt(1, 2, ctx);
  return Array.from({ length: count }, () => pick(PM_BODIES, ctx)).join('\n\n');
}

// ─── Fake Download URL ────────────────────────────────────────────────────────

export function makeSeedDownloadUrl(
  releaseId: number,
  contribIndex: number
): string {
  return `https://seed.invalid/files/r${releaseId}-c${contribIndex}.zip`;
}

// ─── Warn / Admin Comment ─────────────────────────────────────────────────────

const WARN_REASONS = [
  'Uploaded a known transcode as lossless. Please verify file quality before contributing.',
  'Repeated failure to follow contribution formatting rules.',
  'Inappropriate behavior in the forum. This is a formal warning.',
  'Ratio has fallen below minimum threshold — account under review.',
  'Violated community guidelines regarding multiple accounts.'
];

const ADMIN_COMMENTS = [
  'Account flagged by ratio watch — monitoring activity.',
  'User has been warned twice. Next violation will result in restriction.',
  'Long-standing member with generally good standing. Monitor closely.',
  'Account created via invite from trusted member.',
  'Staff member — elevated trust.'
];

export function makeWarnReason(ctx: SeedContext): string {
  return pick(WARN_REASONS, ctx);
}

export function makeAdminComment(ctx: SeedContext): string {
  return pick(ADMIN_COMMENTS, ctx);
}

// ─── DNC Item ─────────────────────────────────────────────────────────────────

const DNC_NAMES = [
  'Various Artists - Compilation XYZ',
  'Label Sampler 2003',
  'Bootleg Recording — Poor Quality',
  'Pirated Commercial Release',
  'Scene NFO Missing — Unverifiable',
  'Region-Locked Release — Not Permitted'
];

const DNC_COMMENTS = [
  'This release has been reviewed and confirmed as a transcode. Do not accept future uploads.',
  'Duplicate of existing verified release. Any new upload will be removed immediately.',
  'Sourced from a pirated distribution. Banned under community rules.',
  'Release is incomplete and has never been fully sourced. Closed.',
  'Legal concerns — community legal team has advised against hosting.'
];

export function makeDncName(ctx: SeedContext): string {
  return pick(DNC_NAMES, ctx);
}

export function makeDncComment(ctx: SeedContext): string {
  return pick(DNC_COMMENTS, ctx);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Generate a realistic file size in bytes (5 MB – 2 GB) */
export function makeFileSizeBytes(ctx: SeedContext): bigint {
  const mb = randInt(5, 2000, ctx);
  return BigInt(mb) * 1_000_000n;
}

/** Generate a realistic contributed/consumed bytes value (0 GB – 500 GB) */
export function makeTransferBytes(ctx: SeedContext): bigint {
  const gb = randInt(0, 500, ctx);
  const mb = randInt(0, 999, ctx);
  return BigInt(gb) * 1_000_000_000n + BigInt(mb) * 1_000_000n;
}

/** Generate a past timestamp within the last N days */
export function pastDate(maxDaysAgo: number, ctx: SeedContext): Date {
  return daysAgo(0, maxDaysAgo, ctx);
}
