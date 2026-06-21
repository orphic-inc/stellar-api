import { checkVersionConsistency } from './versionConsistency';

describe('checkVersionConsistency', () => {
  it('reports no mismatches when every present surface agrees with the manifest', () => {
    const result = checkVersionConsistency({
      manifest: '0.5.6',
      lockfile: '0.5.6',
      changelogTop: '0.5.6',
      runtime: '0.5.6'
    });
    expect(result).toEqual([]);
  });

  it('flags a lockfile that lags the manifest (the recurring drift)', () => {
    const result = checkVersionConsistency({
      manifest: '0.5.6',
      lockfile: '0.5.5'
    });
    expect(result).toEqual([
      { surface: 'lockfile', expected: '0.5.6', actual: '0.5.5' }
    ]);
  });

  it('flags a CHANGELOG whose top dated section lags the manifest', () => {
    const result = checkVersionConsistency({
      manifest: '0.5.6',
      lockfile: '0.5.6',
      changelogTop: '0.5.5'
    });
    expect(result).toEqual([
      { surface: 'changelog', expected: '0.5.6', actual: '0.5.5' }
    ]);
  });

  it('flags an API runtime version that no longer derives the manifest', () => {
    const result = checkVersionConsistency({
      manifest: '0.5.6',
      lockfile: '0.5.6',
      runtime: '0.1.0'
    });
    expect(result).toEqual([
      { surface: 'runtime', expected: '0.5.6', actual: '0.1.0' }
    ]);
  });

  it('ignores the tag axis by default (a release bump runs ahead of the tag)', () => {
    const result = checkVersionConsistency({
      manifest: '0.5.6',
      lockfile: '0.5.6',
      latestTag: '0.5.5'
    });
    expect(result).toEqual([]);
  });

  it('flags a tag mismatch only when the tag axis is explicitly enabled', () => {
    const result = checkVersionConsistency(
      { manifest: '0.5.6', lockfile: '0.5.6', latestTag: '0.5.5' },
      { checkTag: true }
    );
    expect(result).toEqual([
      { surface: 'tag', expected: '0.5.6', actual: '0.5.5' }
    ]);
  });

  it('skips the tag axis when no tag is available, even with checkTag', () => {
    const result = checkVersionConsistency(
      { manifest: '0.5.6', lockfile: '0.5.6', latestTag: null },
      { checkTag: true }
    );
    expect(result).toEqual([]);
  });

  it('aggregates every disagreeing surface in a single pass', () => {
    const result = checkVersionConsistency(
      {
        manifest: '0.5.6',
        lockfile: '0.5.5',
        changelogTop: '0.5.4',
        latestTag: '0.5.5'
      },
      { checkTag: true }
    );
    expect(result.map((m) => m.surface)).toEqual([
      'lockfile',
      'changelog',
      'tag'
    ]);
  });
});
