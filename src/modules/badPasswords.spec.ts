import {
  COMMON_BAD_PASSWORDS,
  normalizePassword,
  seedBadPasswords
} from './badPasswords';

describe('COMMON_BAD_PASSWORDS', () => {
  it('is entirely lowercase', () => {
    // The lookup lowercases its candidate, so a mixed-case entry would be
    // stored and never matched — unreachable, not merely redundant.
    expect(
      COMMON_BAD_PASSWORDS.filter((p) => p !== p.toLowerCase())
    ).toHaveLength(0);
  });

  it('has no duplicates', () => {
    expect(new Set(COMMON_BAD_PASSWORDS).size).toBe(
      COMMON_BAD_PASSWORDS.length
    );
  });

  it('contains nothing shorter than the six-character floor', () => {
    // min(6) is enforced on every creation path, so a shorter entry could never
    // be submitted to match against. Guards against padding the list with rows
    // that cannot fire.
    expect(COMMON_BAD_PASSWORDS.filter((p) => p.length < 6)).toHaveLength(0);
  });

  it('covers the passwords this exists for', () => {
    for (const p of ['123456', 'password', 'qwerty', 'letmein']) {
      expect(COMMON_BAD_PASSWORDS).toContain(p);
    }
  });
});

describe('normalizePassword', () => {
  it('folds case', () => {
    expect(normalizePassword('PASSWORD')).toBe('password');
    expect(normalizePassword('PaSsWoRd')).toBe('password');
  });

  it('preserves whitespace', () => {
    // Trimming would deny a password the user can still type.
    expect(normalizePassword(' hunter2 ')).toBe(' hunter2 ');
  });
});

describe('seedBadPasswords', () => {
  const makeClient = (
    settings: { badPasswordsSeededAt: Date | null } | null
  ) => ({
    siteSettings: {
      findUnique: jest.fn().mockResolvedValue(settings),
      upsert: jest.fn().mockResolvedValue({})
    },
    badPassword: { createMany: jest.fn().mockResolvedValue({ count: 0 }) }
  });

  it('seeds and stamps the marker on a fresh database', async () => {
    const client = makeClient({ badPasswordsSeededAt: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedBadPasswords(client as any);

    expect(client.badPassword.createMany).toHaveBeenCalledTimes(1);
    const arg = client.badPassword.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(COMMON_BAD_PASSWORDS.length);
    expect(arg.skipDuplicates).toBe(true);
    expect(
      arg.data.every((r: { source: string }) => r.source === 'SEEDED')
    ).toBe(true);
    expect(client.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it('upserts the settings row rather than updating it', async () => {
    // On a fresh database nothing has created site_settings yet — no migration
    // plants it and it is otherwise made lazily. An update would throw.
    const client = makeClient(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedBadPasswords(client as any);

    expect(client.badPassword.createMany).toHaveBeenCalledTimes(1);
    const upsertArg = client.siteSettings.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ id: 1 });
    expect(upsertArg.create.badPasswordsSeededAt).toBeInstanceOf(Date);
  });

  it('is a no-op once the marker is stamped', async () => {
    const client = makeClient({ badPasswordsSeededAt: new Date() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedBadPasswords(client as any);

    expect(client.badPassword.createMany).not.toHaveBeenCalled();
    expect(client.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it('does not resurrect rows staff deleted', async () => {
    // The guard is the recorded marker, not a row count (ADR-0022). A
    // count-based guard would re-insert the whole list here.
    const client = makeClient({ badPasswordsSeededAt: new Date('2026-01-01') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedBadPasswords(client as any);

    expect(client.badPassword.createMany).not.toHaveBeenCalled();
  });
});
