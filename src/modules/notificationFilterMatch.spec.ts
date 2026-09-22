/**
 * The contribution notification filter predicate (#263, ADR-0049) — pure, so
 * the whole matrix runs without a database.
 */
import {
  filterMatches,
  isFirstMatchOnRelease,
  hasCriterion,
  type ContributionFacts,
  type FilterCriteria
} from './notificationFilterMatch';

const empty: FilterCriteria = {
  artistIds: [],
  tags: [],
  notTags: [],
  communityIds: [],
  releaseTypes: [],
  releaseCategories: [],
  fileTypes: [],
  bitrates: [],
  media: [],
  fromYear: null,
  toYear: null,
  newReleasesOnly: false,
  excludeCompilations: false,
  mainCreditsOnly: false
};

const facts: ContributionFacts = {
  communityId: 3,
  releaseType: 'Music',
  releaseCategory: 'Album',
  fileType: 'flac',
  bitrate: 'Lossless',
  media: 'CD',
  releaseYear: 1994,
  editionYear: 2014,
  tags: ['shoegaze', 'dream.pop'],
  credits: [
    { artistId: 10, role: 'Main' },
    { artistId: 20, role: 'Guest' }
  ]
};

const f = (over: Partial<FilterCriteria>): FilterCriteria => ({
  ...empty,
  ...over
});

describe('filterMatches', () => {
  it('matches everything when every list is empty', () => {
    expect(filterMatches(empty, facts)).toBe(true);
  });

  describe('artists', () => {
    it('matches through any credit by default, guest included', () => {
      expect(filterMatches(f({ artistIds: [20] }), facts)).toBe(true);
    });

    it('does not match an artist with no credit', () => {
      expect(filterMatches(f({ artistIds: [99] }), facts)).toBe(false);
    });

    it('mainCreditsOnly ignores a guest credit', () => {
      expect(
        filterMatches(f({ artistIds: [20], mainCreditsOnly: true }), facts)
      ).toBe(false);
    });

    it.each(['Main', 'Composer', 'Conductor', 'DJ'] as const)(
      'mainCreditsOnly still matches through %s',
      (role) => {
        const withRole = { ...facts, credits: [{ artistId: 30, role }] };
        expect(
          filterMatches(f({ artistIds: [30], mainCreditsOnly: true }), withRole)
        ).toBe(true);
      }
    );

    it.each(['Guest', 'Remixer', 'Producer', 'Arranger'] as const)(
      'mainCreditsOnly does not match through %s',
      (role) => {
        const withRole = { ...facts, credits: [{ artistId: 30, role }] };
        expect(
          filterMatches(f({ artistIds: [30], mainCreditsOnly: true }), withRole)
        ).toBe(false);
      }
    );
  });

  describe('excludeCompilations', () => {
    const credits = (n: number, role: 'Main' | 'Guest' = 'Main') =>
      Array.from({ length: n }, (_, i) => ({ artistId: 100 + i, role }));

    it('keeps a release with two main-class credits', () => {
      expect(
        filterMatches(f({ excludeCompilations: true }), {
          ...facts,
          credits: credits(2)
        })
      ).toBe(true);
    });

    it('skips a release with three', () => {
      expect(
        filterMatches(f({ excludeCompilations: true }), {
          ...facts,
          credits: credits(3)
        })
      ).toBe(false);
    });

    it('counts only main-class credits toward the threshold', () => {
      expect(
        filterMatches(f({ excludeCompilations: true }), {
          ...facts,
          credits: [...credits(2), ...credits(5, 'Guest')]
        })
      ).toBe(true);
    });

    it('counts an artist credited in two main-class roles once', () => {
      expect(
        filterMatches(f({ excludeCompilations: true }), {
          ...facts,
          credits: [
            { artistId: 1, role: 'Main' },
            { artistId: 1, role: 'Composer' },
            { artistId: 2, role: 'Main' }
          ]
        })
      ).toBe(true);
    });

    it('is off by default, so a compilation still matches', () => {
      expect(filterMatches(empty, { ...facts, credits: credits(9) })).toBe(
        true
      );
    });
  });

  describe('tags', () => {
    it('matches when any listed tag is on the release', () => {
      expect(filterMatches(f({ tags: ['jazz', 'shoegaze'] }), facts)).toBe(
        true
      );
    });

    it('does not match when none is', () => {
      expect(filterMatches(f({ tags: ['jazz'] }), facts)).toBe(false);
    });

    it('refuses a release carrying any excluded tag', () => {
      expect(filterMatches(f({ notTags: ['dream.pop'] }), facts)).toBe(false);
    });

    it('lets an excluded tag veto an included one', () => {
      expect(
        filterMatches(f({ tags: ['shoegaze'], notTags: ['dream.pop'] }), facts)
      ).toBe(false);
    });
  });

  describe('communities', () => {
    it('matches a listed community', () => {
      expect(filterMatches(f({ communityIds: [3] }), facts)).toBe(true);
    });

    it('does not match another', () => {
      expect(filterMatches(f({ communityIds: [4] }), facts)).toBe(false);
    });

    it('does not match a release with no community', () => {
      expect(
        filterMatches(f({ communityIds: [3] }), { ...facts, communityId: null })
      ).toBe(false);
    });
  });

  describe('enumerated fields', () => {
    it.each<[string, Partial<FilterCriteria>, boolean]>([
      ['releaseTypes', { releaseTypes: ['Music'] }, true],
      ['releaseTypes', { releaseTypes: ['Comics'] }, false],
      ['releaseCategories', { releaseCategories: ['Album'] }, true],
      ['releaseCategories', { releaseCategories: ['EP'] }, false],
      ['fileTypes', { fileTypes: ['flac'] }, true],
      ['fileTypes', { fileTypes: ['mp3'] }, false],
      ['bitrates', { bitrates: ['Lossless'] }, true],
      ['bitrates', { bitrates: ['Kbps320'] }, false],
      ['media', { media: ['CD'] }, true],
      ['media', { media: ['WEB'] }, false]
    ])('%s %j → %s', (_field, over, expected) => {
      expect(filterMatches(f(over), facts)).toBe(expected);
    });

    // The legacy rule: an upload missing a value matches only a filter that
    // leaves that field empty.
    it.each<[keyof ContributionFacts, Partial<FilterCriteria>]>([
      ['releaseCategory', { releaseCategories: ['Album'] }],
      ['bitrate', { bitrates: ['Lossless'] }],
      ['media', { media: ['CD'] }]
    ])(
      'a contribution with no %s does not match a filter naming one',
      (field, over) => {
        expect(
          filterMatches(f(over), {
            ...facts,
            [field]: null
          })
        ).toBe(false);
      }
    );

    it('a contribution with no bitrate still matches a filter leaving it empty', () => {
      expect(filterMatches(empty, { ...facts, bitrate: null })).toBe(true);
    });
  });

  describe('years', () => {
    it('matches the release year', () => {
      expect(filterMatches(f({ fromYear: 1990, toYear: 1999 }), facts)).toBe(
        true
      );
    });

    it('matches the edition year when the release year is outside', () => {
      expect(filterMatches(f({ fromYear: 2010, toYear: 2019 }), facts)).toBe(
        true
      );
    });

    it('does not match when neither year is inside', () => {
      expect(filterMatches(f({ fromYear: 2000, toYear: 2009 }), facts)).toBe(
        false
      );
    });

    it('takes either bound alone', () => {
      expect(filterMatches(f({ fromYear: 2015 }), facts)).toBe(false);
      expect(filterMatches(f({ toYear: 1994 }), facts)).toBe(true);
    });

    it('is inclusive at both ends', () => {
      expect(filterMatches(f({ fromYear: 2014, toYear: 2014 }), facts)).toBe(
        true
      );
    });

    it('uses the release year alone when there is no edition year', () => {
      expect(
        filterMatches(f({ fromYear: 2010 }), { ...facts, editionYear: null })
      ).toBe(false);
    });
  });
});

describe('isFirstMatchOnRelease', () => {
  const mp3 = { fileType: 'mp3', bitrate: 'Kbps320' } as const;
  const flac = { fileType: 'flac', bitrate: 'Lossless' } as const;

  it('is true when nothing came before', () => {
    expect(isFirstMatchOnRelease(empty, [])).toBe(true);
  });

  it('is false for an unconstrained filter once anything came before', () => {
    expect(isFirstMatchOnRelease(empty, [mp3])).toBe(false);
  });

  it('fires on the first FLAC after MP3s, which is the point of the flag', () => {
    expect(isFirstMatchOnRelease(f({ fileTypes: ['flac'] }), [mp3, mp3])).toBe(
      true
    );
  });

  it('does not fire on the second FLAC', () => {
    expect(isFirstMatchOnRelease(f({ fileTypes: ['flac'] }), [mp3, flac])).toBe(
      false
    );
  });

  it('reads bitrate as well as file type', () => {
    const v0 = { fileType: 'mp3', bitrate: 'KbpsV0' } as const;
    expect(isFirstMatchOnRelease(f({ bitrates: ['KbpsV0'] }), [mp3])).toBe(
      true
    );
    expect(isFirstMatchOnRelease(f({ bitrates: ['KbpsV0'] }), [v0])).toBe(
      false
    );
  });

  it('treats an earlier contribution with no bitrate as not matching a bitrate', () => {
    expect(
      isFirstMatchOnRelease(f({ bitrates: ['Lossless'] }), [
        { fileType: 'flac', bitrate: null }
      ])
    ).toBe(true);
  });
});

describe('hasCriterion', () => {
  it('is false for an empty filter', () => {
    expect(hasCriterion(empty)).toBe(false);
  });

  it.each([
    ['artistIds', { artistIds: [1] }],
    ['tags', { tags: ['rock'] }],
    ['notTags', { notTags: ['rock'] }],
    ['communityIds', { communityIds: [1] }],
    ['releaseTypes', { releaseTypes: ['Music'] }],
    ['releaseCategories', { releaseCategories: ['EP'] }],
    ['fileTypes', { fileTypes: ['flac'] }],
    ['bitrates', { bitrates: ['Lossless'] }],
    ['media', { media: ['CD'] }],
    ['fromYear', { fromYear: 1990 }],
    ['toYear', { toYear: 1990 }],
    // A flag alone is a criterion: "every new release" is a deliberate filter.
    ['newReleasesOnly', { newReleasesOnly: true }],
    ['excludeCompilations', { excludeCompilations: true }],
    ['mainCreditsOnly', { mainCreditsOnly: true }]
  ] as Array<[string, Partial<FilterCriteria>]>)(
    'counts %s',
    (_field, over) => {
      expect(hasCriterion(f(over))).toBe(true);
    }
  );
});
