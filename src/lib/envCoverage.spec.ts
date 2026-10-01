import {
  checkEnvCoverage,
  extractEnvAssignments,
  extractEnvReads,
  extractPrismaEnvReads,
  extractTableNames,
  type EnvSurfaces
} from './envCoverage';

// One consistent set of surfaces; each case breaks exactly one thing.
const surfaces = (over: Partial<EnvSurfaces> = {}): EnvSurfaces => ({
  runtimeReads: ['STELLAR_A', 'NODE_ENV'],
  allReads: ['STELLAR_A', 'STELLAR_B', 'NODE_ENV'],
  envDefault: ['STELLAR_A', 'STELLAR_B'],
  docs: ['STELLAR_A', 'STELLAR_B'],
  agents: ['STELLAR_A'],
  ...over
});

describe('checkEnvCoverage (#682)', () => {
  it('passes when the surfaces agree', () => {
    expect(checkEnvCoverage(surfaces())).toEqual({
      ok: true,
      missingFromEnvDefault: [],
      missingFromDocs: [],
      staleInAgents: [],
      unread: []
    });
  });

  it('fails on a runtime read .env.default lacks', () => {
    const r = checkEnvCoverage(
      surfaces({ runtimeReads: ['STELLAR_A', 'STELLAR_NEW'] })
    );

    expect(r.ok).toBe(false);
    expect(r.missingFromEnvDefault).toEqual(['STELLAR_NEW']);
  });

  it('lets an allowlisted platform variable through', () => {
    expect(checkEnvCoverage(surfaces()).missingFromEnvDefault).toEqual([]);
    expect(
      checkEnvCoverage(surfaces(), {
        notOperatorSet: [],
        readIndirectly: []
      }).missingFromEnvDefault
    ).toEqual(['NODE_ENV']);
  });

  it('fails on a .env.default variable the docs do not explain', () => {
    const r = checkEnvCoverage(surfaces({ docs: ['STELLAR_A'] }));

    expect(r.ok).toBe(false);
    expect(r.missingFromDocs).toEqual(['STELLAR_B']);
  });

  it('reads a PREFIX_* docs row as covering every name under it', () => {
    const smtp = ['STELLAR_SMTP_HOST', 'STELLAR_SMTP_PORT'];
    const r = checkEnvCoverage(
      surfaces({
        allReads: smtp,
        envDefault: smtp,
        docs: ['STELLAR_SMTP_*'],
        agents: [],
        runtimeReads: []
      })
    );

    expect(r.ok).toBe(true);
  });

  it('does not read a wildcard as covering a name outside its prefix', () => {
    const r = checkEnvCoverage(
      surfaces({
        allReads: ['STELLAR_SITE_URL'],
        envDefault: ['STELLAR_SITE_URL'],
        docs: ['STELLAR_SMTP_*'],
        agents: [],
        runtimeReads: []
      })
    );

    expect(r.missingFromDocs).toEqual(['STELLAR_SITE_URL']);
  });

  it("fails on a name in AGENTS.md's table .env.default no longer has", () => {
    const r = checkEnvCoverage(
      surfaces({ agents: ['STELLAR_A', 'STELLAR_RETIRED'] })
    );

    expect(r.ok).toBe(false);
    expect(r.staleInAgents).toEqual(['STELLAR_RETIRED']);
  });

  it("does not require AGENTS.md's table to be complete", () => {
    expect(checkEnvCoverage(surfaces({ agents: [] })).ok).toBe(true);
  });

  it('fails on a .env.default variable nothing reads', () => {
    const r = checkEnvCoverage(surfaces({ allReads: ['STELLAR_A'] }));

    expect(r.ok).toBe(false);
    expect(r.unread).toEqual(['STELLAR_B']);
  });

  it('lets an allowlisted indirect read through', () => {
    const r = checkEnvCoverage(surfaces({ allReads: ['STELLAR_A'] }), {
      notOperatorSet: ['NODE_ENV'],
      readIndirectly: ['STELLAR_B']
    });

    expect(r.ok).toBe(true);
  });
});

describe('extractEnvReads', () => {
  it('finds dot access', () => {
    expect(extractEnvReads("const a = process.env.STELLAR_A ?? 'x';")).toEqual([
      'STELLAR_A'
    ]);
  });

  it('finds quoted bracket access, either quote', () => {
    expect(
      extractEnvReads(`process.env['STELLAR_A']; process.env["STELLAR_B"];`)
    ).toEqual(['STELLAR_A', 'STELLAR_B']);
  });

  it('finds a literal requireEnv name', () => {
    expect(
      extractEnvReads("secret: requireEnv('STELLAR_AUTH_JWT_SECRET', 32),")
    ).toEqual(['STELLAR_AUTH_JWT_SECRET']);
  });

  it('ignores a computed key and lowercase names', () => {
    expect(
      extractEnvReads('process.env[key]; process.env.npm_config_x;')
    ).toEqual([]);
  });

  it('reports each name once', () => {
    expect(
      extractEnvReads('process.env.STELLAR_A; process.env.STELLAR_A;')
    ).toEqual(['STELLAR_A']);
  });
});

describe('extractPrismaEnvReads', () => {
  it('finds env("…") in a schema', () => {
    expect(
      extractPrismaEnvReads('url = env("STELLAR_PSQL_URI")\nx = env( "B_C" )')
    ).toEqual(['B_C', 'STELLAR_PSQL_URI']);
  });
});

describe('extractEnvAssignments', () => {
  it('finds assignments and skips comments that name a variable', () => {
    const dotenv = [
      '# STELLAR_RETIRED= is ignored now',
      'STELLAR_A=1',
      'STELLAR_B=',
      '',
      'STELLAR_C="quoted value"'
    ].join('\n');

    expect(extractEnvAssignments(dotenv)).toEqual([
      'STELLAR_A',
      'STELLAR_B',
      'STELLAR_C'
    ]);
  });
});

describe('extractTableNames', () => {
  const doc = [
    '# Title',
    '',
    '## Environment',
    '',
    'Intro naming `STELLAR_PROSE` outside the table.',
    '',
    '| Variable | Purpose |',
    '| -------- | ------- |',
    '| `STELLAR_A` | Purpose naming `STELLAR_RETIRED` |',
    '| `STELLAR_SMTP_*`, `STELLAR_B` | A grouped row |',
    '',
    '| `STELLAR_SECOND_TABLE` | Not the env table |',
    '',
    '## Next section',
    '',
    '| `STELLAR_OTHER` | Another section |'
  ].join('\n');

  it('reads the first column of the first table under the heading', () => {
    expect(extractTableNames(doc, '## Environment')).toEqual([
      'STELLAR_A',
      'STELLAR_B',
      'STELLAR_SMTP_*'
    ]);
  });

  it('reads nothing when the heading is absent', () => {
    expect(extractTableNames(doc, '## Missing')).toEqual([]);
  });

  it('does not match a longer heading that starts the same way', () => {
    const renamed = doc.replace('## Environment', '## Environment reference');

    expect(extractTableNames(renamed, '## Environment')).toEqual([]);
  });
});
