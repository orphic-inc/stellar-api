/**
 * Unit tests for the egress guard. DNS is mocked — the point is the decision
 * table, not the resolver — and literal-address cases bypass it entirely.
 */

const mockLookup = jest.fn();
jest.mock('node:dns/promises', () => ({ lookup: mockLookup }));

import { checkPublicUrl } from './ssrfGuard';

/** Resolve every hostname to one public address unless a test says otherwise. */
const resolvesTo = (...addresses: string[]) =>
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address })));

beforeEach(() => {
  jest.clearAllMocks();
  resolvesTo('93.184.216.34');
});

describe('protocol handling', () => {
  it.each(['http://example.com/f.zip', 'https://example.com/f.zip'])(
    'allows %s',
    async (url) => {
      await expect(checkPublicUrl(url)).resolves.toMatchObject({ ok: true });
    }
  );

  // z.string().url() accepts all of these, which is exactly why the guard
  // cannot rely on the input schema.
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/f.zip',
    'gopher://example.com/',
    'data:text/plain,hello'
  ])('rejects %s', async (url) => {
    const result = await checkPublicUrl(url);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty(
      'reason',
      expect.stringContaining('disallowed protocol')
    );
  });

  it('rejects a string that is not a URL at all', async () => {
    await expect(checkPublicUrl('not a url')).resolves.toMatchObject({
      ok: false,
      reason: 'unparseable URL'
    });
  });
});

describe('literal addresses', () => {
  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback', 'http://127.0.0.1:5432/'],
    ['loopback shorthand', 'http://127.1/'],
    ['RFC1918 10/8', 'http://10.0.0.5/'],
    ['RFC1918 172.16/12', 'http://172.16.31.9/'],
    ['RFC1918 192.168/16', 'http://192.168.1.1/'],
    ['carrier-grade NAT', 'http://100.64.0.1/'],
    ['this-network', 'http://0.0.0.0/'],
    ['multicast', 'http://224.0.0.1/'],
    ['IPv6 loopback', 'http://[::1]:8080/'],
    ['IPv6 unique-local', 'http://[fc00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/']
  ])('rejects %s', async (_label, url) => {
    const result = await checkPublicUrl(url);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty(
      'reason',
      expect.stringContaining('not publicly routable')
    );
  });

  it('allows a public literal address', async () => {
    await expect(checkPublicUrl('http://93.184.216.34/f.zip')).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
  });

  it('never consults DNS for a literal address', async () => {
    await checkPublicUrl('http://127.0.0.1/');
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe('name resolution', () => {
  it('rejects a public name that resolves inward', async () => {
    resolvesTo('169.254.169.254');
    const result = await checkPublicUrl('http://metadata.example.com/');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty(
      'reason',
      expect.stringContaining('resolves to non-routable address')
    );
  });

  // Fail-closed: which address the HTTP client picks is not ours to predict, so
  // a split result is treated as the dangerous one.
  it('rejects when only one of several addresses is private', async () => {
    resolvesTo('93.184.216.34', '10.0.0.5');
    await expect(
      checkPublicUrl('http://split.example.com/')
    ).resolves.toMatchObject({ ok: false });
  });

  it('rejects a name that does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      checkPublicUrl('http://nope.example.test/')
    ).resolves.toMatchObject({ ok: false, reason: expect.any(String) });
  });

  it('rejects a name that resolves to nothing', async () => {
    mockLookup.mockResolvedValue([]);
    await expect(
      checkPublicUrl('http://empty.example.com/')
    ).resolves.toMatchObject({ ok: false });
  });

  it('allows a name that resolves entirely to public space', async () => {
    resolvesTo('93.184.216.34', '151.101.1.140');
    await expect(
      checkPublicUrl('http://example.com/f.zip')
    ).resolves.toMatchObject({ ok: true });
  });
});
