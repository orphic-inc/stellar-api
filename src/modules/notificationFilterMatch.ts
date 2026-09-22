import type {
  ArtistRole,
  Bitrate,
  FileType,
  ReleaseCategory,
  ReleaseMedia,
  ReleaseType
} from '@prisma/client';

/**
 * The contribution notification filter predicate (#263, ADR-0049).
 *
 * PURE. The facts about a contribution go in, and whether one filter wants it
 * comes out. `notificationFilters.ts` owns the database: it loads the facts,
 * narrows the candidate filters with array operators, and applies access. What
 * is left here is everything a Postgres `hasSome` cannot say.
 *
 * Every list reads "empty, or the contribution has one of these". A contribution
 * MISSING a value — no bitrate, no media, no category — therefore matches only a
 * filter that leaves that list empty, which is the legacy rule.
 */

/** The fields of a `NotificationFilter` the predicate reads. */
export type FilterCriteria = {
  artistIds: number[];
  tags: string[];
  notTags: string[];
  communityIds: number[];
  releaseTypes: ReleaseType[];
  releaseCategories: ReleaseCategory[];
  fileTypes: FileType[];
  bitrates: Bitrate[];
  media: ReleaseMedia[];
  fromYear: number | null;
  toYear: number | null;
  newReleasesOnly: boolean;
  excludeCompilations: boolean;
  mainCreditsOnly: boolean;
};

/** What a new contribution is, as far as a filter can ask. */
export type ContributionFacts = {
  communityId: number | null;
  releaseType: ReleaseType;
  releaseCategory: ReleaseCategory | null;
  fileType: FileType;
  bitrate: Bitrate | null;
  media: ReleaseMedia | null;
  releaseYear: number;
  editionYear: number | null;
  /** Canonical names (#689). */
  tags: string[];
  credits: Array<{ artistId: number; role: ArtistRole }>;
};

/**
 * The roles that make an artist the release's own rather than a guest on it —
 * the legacy implementation's main-class importances. A credit in any other
 * role (Guest, Remixer, Producer, Arranger) is an appearance.
 */
export const MAIN_CLASS_ROLES: readonly ArtistRole[] = [
  'Main',
  'Composer',
  'Conductor',
  'DJ'
];

/** More distinct main-class artists than this makes a release a compilation. */
export const COMPILATION_THRESHOLD = 2;

const isMainClass = (role: ArtistRole) => MAIN_CLASS_ROLES.includes(role);

/** Empty, or `value` is one of them. A missing value satisfies only empty. */
const allows = <T>(list: readonly T[], value: T | null): boolean =>
  list.length === 0 || (value !== null && list.includes(value));

const withinYears = (filter: FilterCriteria, facts: ContributionFacts) => {
  if (filter.fromYear === null && filter.toYear === null) return true;
  const inRange = (year: number) =>
    (filter.fromYear === null || year >= filter.fromYear) &&
    (filter.toYear === null || year <= filter.toYear);
  // The release year or the edition year, as the legacy implementation read the
  // group year or the remaster year: a filter for the 2010s wants a 2014
  // reissue of a 1994 album.
  return (
    inRange(facts.releaseYear) ||
    (facts.editionYear !== null && inRange(facts.editionYear))
  );
};

const artistsMatch = (filter: FilterCriteria, facts: ContributionFacts) => {
  if (filter.artistIds.length === 0) return true;
  return facts.credits.some(
    (credit) =>
      filter.artistIds.includes(credit.artistId) &&
      (!filter.mainCreditsOnly || isMainClass(credit.role))
  );
};

const isCompilation = (facts: ContributionFacts) =>
  new Set(
    facts.credits.filter((c) => isMainClass(c.role)).map((c) => c.artistId)
  ).size > COMPILATION_THRESHOLD;

/**
 * Does `filter` want this contribution? Everything but `newReleasesOnly`, which
 * needs the release's earlier contributions — see `isFirstMatchOnRelease` — and
 * access, which needs the database.
 */
export const filterMatches = (
  filter: FilterCriteria,
  facts: ContributionFacts
): boolean =>
  artistsMatch(filter, facts) &&
  !(filter.excludeCompilations && isCompilation(facts)) &&
  (filter.tags.length === 0 ||
    facts.tags.some((tag) => filter.tags.includes(tag))) &&
  !facts.tags.some((tag) => filter.notTags.includes(tag)) &&
  allows(filter.communityIds, facts.communityId) &&
  allows(filter.releaseTypes, facts.releaseType) &&
  allows(filter.releaseCategories, facts.releaseCategory) &&
  allows(filter.fileTypes, facts.fileType) &&
  allows(filter.bitrates, facts.bitrate) &&
  allows(filter.media, facts.media) &&
  withinYears(filter, facts);

/**
 * `newReleasesOnly`: is this the first contribution on its release to satisfy
 * THIS filter's format constraints?
 *
 * Not "the first contribution on the release". The legacy `NewGroupsOnly` asked
 * whether any earlier upload in the group matched the filter's format and
 * bitrate, so a FLAC-only filter still fires on the first FLAC of an album that
 * already had three MP3s — which is what the flag is for. `earlier` is every
 * contribution on the release before this one.
 */
export const isFirstMatchOnRelease = (
  filter: Pick<FilterCriteria, 'fileTypes' | 'bitrates'>,
  earlier: Array<{ fileType: FileType; bitrate: Bitrate | null }>
): boolean =>
  !earlier.some(
    (c) =>
      allows(filter.fileTypes, c.fileType) && allows(filter.bitrates, c.bitrate)
  );

/**
 * Does the filter say anything at all? The legacy rule: at least one field set,
 * and a flag counts — "every new release" is a deliberate filter, not an
 * accident. Only a filter with nothing set is refused.
 */
export const hasCriterion = (filter: FilterCriteria): boolean =>
  filter.artistIds.length > 0 ||
  filter.tags.length > 0 ||
  filter.notTags.length > 0 ||
  filter.communityIds.length > 0 ||
  filter.releaseTypes.length > 0 ||
  filter.releaseCategories.length > 0 ||
  filter.fileTypes.length > 0 ||
  filter.bitrates.length > 0 ||
  filter.media.length > 0 ||
  filter.fromYear !== null ||
  filter.toYear !== null ||
  filter.newReleasesOnly ||
  filter.excludeCompilations ||
  filter.mainCreditsOnly;
