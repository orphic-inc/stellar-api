/**
 * `site.ircGuideUrl`'s default (#622). Config is read at import, so each case
 * loads a fresh copy of the module under its own environment.
 */
const loadSite = async (env: Record<string, string>) => {
  const saved = { ...process.env };
  // Required by config.ts at import; irrelevant to what is tested here.
  process.env.STELLAR_AUTH_JWT_SECRET = 'x'.repeat(32);
  // Set explicitly (empty = unset) so a developer's .env cannot leak in:
  // dotenv never overrides a key already present in process.env.
  process.env.STELLAR_PUBLIC_KB_BASE = '';
  process.env.STELLAR_IRC_GUIDE_URL = '';
  Object.assign(process.env, env);
  try {
    jest.resetModules();
    return (await import('./config')).site;
  } finally {
    process.env = saved;
  }
};

describe('site.ircGuideUrl', () => {
  it('defaults to the public KB root plus /irc', async () => {
    expect((await loadSite({})).ircGuideUrl).toBe(
      'https://korin.pink/wiki/irc'
    );
  });

  it('follows an operator-set KB root, without doubling a trailing slash', async () => {
    expect(
      (await loadSite({ STELLAR_PUBLIC_KB_BASE: 'https://kb.example.com/' }))
        .ircGuideUrl
    ).toBe('https://kb.example.com/irc');
  });

  it('uses STELLAR_IRC_GUIDE_URL when set', async () => {
    expect(
      (
        await loadSite({
          STELLAR_IRC_GUIDE_URL: 'https://korin.pink/wiki/connect'
        })
      ).ircGuideUrl
    ).toBe('https://korin.pink/wiki/connect');
  });

  it('is never the in-app ircUrl route', async () => {
    const site = await loadSite({});
    expect(site.ircGuideUrl).not.toBe(site.ircUrl);
  });
});
