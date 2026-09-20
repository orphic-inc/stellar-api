/**
 * `STELLAR_SITE_URL` / `STELLAR_HTTP_CORS_ORIGIN` parsing (#667).
 *
 * `.env.default` ships both keys blank, and the previous `??` read did not
 * catch an empty string — so a copied default gave `siteUrl: ''` and every
 * absolute link the API builds came out origin-relative. Emailed links have no
 * document to resolve against, so password recovery and invite registration
 * failed outright rather than degrading.
 *
 * Config is read at import, so each case loads a fresh copy of the module under
 * its own environment. Keys are set to empty rather than deleted, because
 * dotenv never overrides a key already present in `process.env` and a
 * developer's own `.env` would otherwise leak in.
 */
const loadConfig = async (env: Record<string, string>) => {
  const saved = { ...process.env };
  process.env.STELLAR_AUTH_JWT_SECRET = 'x'.repeat(32);
  process.env.STELLAR_SITE_URL = '';
  process.env.STELLAR_HTTP_CORS_ORIGIN = '';
  process.env.STELLAR_SMTP_PORT = '';
  process.env.STELLAR_SMTP_FROM = '';
  Object.assign(process.env, env);
  try {
    jest.resetModules();
    return await import('./config');
  } finally {
    process.env = saved;
  }
};

const DEV = 'http://localhost:9000';

describe('origin config — an empty value means unset (#667)', () => {
  it('falls back to the dev origin when the value is empty', async () => {
    const { email, http } = await loadConfig({});
    expect(email.siteUrl).toBe(DEV);
    expect(http.corsOrigin).toBe(DEV);
  });

  it('falls back when the key is absent entirely', async () => {
    const saved = { ...process.env };
    process.env.STELLAR_AUTH_JWT_SECRET = 'x'.repeat(32);
    delete process.env.STELLAR_SITE_URL;
    delete process.env.STELLAR_HTTP_CORS_ORIGIN;
    try {
      jest.resetModules();
      const { email } = await import('./config');
      expect(email.siteUrl).toBe(DEV);
    } finally {
      process.env = saved;
    }
  });

  it('falls back on whitespace, which is invisible in a .env file', async () => {
    const { email } = await loadConfig({ STELLAR_SITE_URL: '   ' });
    expect(email.siteUrl).toBe(DEV);
  });

  it('keeps an explicitly configured origin', async () => {
    const { email, http } = await loadConfig({
      STELLAR_SITE_URL: 'https://site.example.test',
      STELLAR_HTTP_CORS_ORIGIN: 'https://ui.example.test'
    });
    expect(email.siteUrl).toBe('https://site.example.test');
    expect(http.corsOrigin).toBe('https://ui.example.test');
  });

  it('defaults to the port the ui dev server listens on, not 3000', async () => {
    // Nothing in this project has ever served the UI on 3000; webpack's
    // devServer is 9000 and proxies /api here.
    const { email } = await loadConfig({});
    expect(email.siteUrl).not.toContain(':3000');
    expect(email.siteUrl).toBe('http://localhost:9000');
  });
});

describe('origin config — trailing slashes are stripped (#667)', () => {
  it('strips one, so callers appending a path do not produce a double slash', async () => {
    const { email } = await loadConfig({
      STELLAR_SITE_URL: 'https://site.example.test/'
    });
    expect(email.siteUrl).toBe('https://site.example.test');
    // The shape every caller builds: `${siteUrl}/recovery?token=…`. A double
    // slash is a different route to the UI router, so recovery would 404.
    expect(`${email.siteUrl}/recovery`).toBe(
      'https://site.example.test/recovery'
    );
  });

  it('strips several', async () => {
    const { email } = await loadConfig({
      STELLAR_SITE_URL: 'https://site.example.test///'
    });
    expect(email.siteUrl).toBe('https://site.example.test');
  });

  it('strips on the CORS origin, which a browser Origin header never carries', async () => {
    const { http } = await loadConfig({
      STELLAR_HTTP_CORS_ORIGIN: 'https://ui.example.test/'
    });
    expect(http.corsOrigin).toBe('https://ui.example.test');
  });

  it('leaves a path-bearing origin otherwise intact', async () => {
    const { email } = await loadConfig({
      STELLAR_SITE_URL: 'https://host.example.test/stellar'
    });
    expect(email.siteUrl).toBe('https://host.example.test/stellar');
  });
});

describe('email config — the same empty-value defect on adjacent keys (#667)', () => {
  it('reads an empty SMTP port as unset rather than NaN', async () => {
    const { email } = await loadConfig({});
    expect(email.smtpPort).toBe(587);
    expect(Number.isNaN(email.smtpPort)).toBe(false);
  });

  it('reads an empty from-address as unset rather than an empty string', async () => {
    const { email } = await loadConfig({});
    expect(email.fromAddress).toBe('noreply@stellar.local');
  });

  it('keeps explicit SMTP values', async () => {
    const { email } = await loadConfig({
      STELLAR_SMTP_PORT: '2525',
      STELLAR_SMTP_FROM: 'mail@example.test'
    });
    expect(email.smtpPort).toBe(2525);
    expect(email.fromAddress).toBe('mail@example.test');
  });
});

describe('PLACEHOLDER_ORIGINS (#667)', () => {
  it('names the dev origin and the example hostnames compose ships', async () => {
    const { PLACEHOLDER_ORIGINS } = await loadConfig({});
    expect(PLACEHOLDER_ORIGINS).toEqual([
      DEV,
      'https://example.org',
      'https://example.com'
    ]);
  });

  it('contains whatever an unset origin resolves to, so install always warns', async () => {
    const { email, http, PLACEHOLDER_ORIGINS } = await loadConfig({});
    expect(PLACEHOLDER_ORIGINS).toContain(email.siteUrl);
    expect(PLACEHOLDER_ORIGINS).toContain(http.corsOrigin);
  });
});
