import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchRemote, type RemoteFetchOptions } from './remoteFetch';
import type { UrlGuardResult } from './ssrfGuard';

// Real sockets against local servers. The production guard refuses loopback,
// so each test injects a check that vets named hosts to 127.0.0.1 and refuses
// the rest — the same contract `checkPublicUrl` has, pointed at a test port.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: http.Server[] = [];

const serve = async (handler: Handler): Promise<number> => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  );
});

/** Vets every host in `allowed` to 127.0.0.1; refuses anything else. */
const checkFor =
  (allowed: string[]) =>
  async (raw: string): Promise<UrlGuardResult> => {
    const url = new URL(raw);
    if (!allowed.includes(url.hostname)) {
      return { ok: false, reason: `host '${url.hostname}' refused` };
    }
    return { ok: true, url, addresses: [{ address: '127.0.0.1', family: 4 }] };
  };

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const opts = (over: Partial<RemoteFetchOptions> = {}): RemoteFetchOptions => ({
  maxBytes: 1024,
  timeoutMs: 2000,
  userAgent: 'StellarImageImport/1.0 (+test)',
  check: checkFor(['images.example']),
  ...over
});

describe('fetchRemote', () => {
  it('returns the body of a vetted host', async () => {
    const port = await serve((_req, res) => res.end(PNG));
    const result = await fetchRemote(
      `http://images.example:${port}/a.png`,
      opts()
    );
    expect(result).toEqual({
      ok: true,
      data: PNG,
      finalUrl: `http://images.example:${port}/a.png`
    });
  });

  it('dials the vetted address and never resolves the name itself', async () => {
    // `.invalid` never resolves (RFC 6761). If the socket asked DNS, this would
    // fail with ENOTFOUND; it succeeds only because the vetted address is pinned.
    const port = await serve((_req, res) => res.end(PNG));
    const result = await fetchRemote(
      `http://rebind.invalid:${port}/a.png`,
      opts({ check: checkFor(['rebind.invalid']) })
    );
    expect(result.ok).toBe(true);
  });

  it('re-vets every redirect hop and refuses an internal target', async () => {
    let internalHits = 0;
    const internal = await serve((_req, res) => {
      internalHits++;
      res.end(PNG);
    });
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: `http://metadata.internal:${internal}/` });
      res.end();
    });
    const result = await fetchRemote(
      `http://images.example:${port}/a.png`,
      opts()
    );
    expect(result).toEqual({
      ok: false,
      reason: "host 'metadata.internal' refused",
      retryable: false
    });
    expect(internalHits).toBe(0);
  });

  it('follows a redirect to another vetted host', async () => {
    const target = await serve((_req, res) => res.end(PNG));
    const port = await serve((_req, res) => {
      res.writeHead(301, { location: `http://cdn.example:${target}/b.png` });
      res.end();
    });
    const result = await fetchRemote(
      `http://images.example:${port}/a.png`,
      opts({ check: checkFor(['images.example', 'cdn.example']) })
    );
    expect(result).toMatchObject({
      ok: true,
      finalUrl: `http://cdn.example:${target}/b.png`
    });
  });

  it('gives up on a redirect loop', async () => {
    const port = await serve((req, res) => {
      res.writeHead(302, { location: req.url });
      res.end();
    });
    const result = await fetchRemote(
      `http://images.example:${port}/loop`,
      opts({ maxRedirects: 3 })
    );
    expect(result).toEqual({
      ok: false,
      reason: 'too many redirects',
      retryable: false
    });
  });

  it('abandons a streamed body the moment it passes the cap', async () => {
    let bytesWritten = 0;
    let closedEarly = false;
    const port = await serve((_req, res) => {
      // No Content-Length: the cap must hold on the stream itself.
      res.writeHead(200);
      const chunk = Buffer.alloc(256, 1);
      const pump = () => {
        if (res.destroyed || closedEarly) return;
        if (bytesWritten >= 64 * 1024) return res.end();
        bytesWritten += chunk.length;
        res.write(chunk, () => setImmediate(pump));
      };
      res.on('close', () => {
        if (bytesWritten < 64 * 1024) closedEarly = true;
      });
      pump();
    });
    const result = await fetchRemote(
      `http://images.example:${port}/big`,
      opts({ maxBytes: 1024 })
    );
    expect(result).toEqual({
      ok: false,
      reason: 'larger than 1024 bytes',
      retryable: false
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(closedEarly).toBe(true);
  });

  it('refuses a declared Content-Length over the cap before reading it', async () => {
    // Declares 5000 bytes, sends 100, then hangs. Only a check on the header
    // answers at once; reading the body instead would wait out the timeout.
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '5000' });
      res.write(Buffer.alloc(100));
    });
    const result = await fetchRemote(
      `http://images.example:${port}/big`,
      opts({ maxBytes: 1024, timeoutMs: 500 })
    );
    expect(result).toEqual({
      ok: false,
      reason: 'larger than 1024 bytes',
      retryable: false
    });
  });

  it('times out a host that never answers, and marks it retryable', async () => {
    const port = await serve(() => {
      /* never responds */
    });
    const result = await fetchRemote(
      `http://images.example:${port}/slow`,
      opts({ timeoutMs: 150 })
    );
    expect(result).toEqual({ ok: false, reason: 'timed out', retryable: true });
  });

  it('treats a 404 as final and a 503 as retryable', async () => {
    const notFound = await serve((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const unavailable = await serve((_req, res) => {
      res.statusCode = 503;
      res.end();
    });
    await expect(
      fetchRemote(`http://images.example:${notFound}/x`, opts())
    ).resolves.toEqual({
      ok: false,
      reason: 'the host answered 404',
      retryable: false
    });
    await expect(
      fetchRemote(`http://images.example:${unavailable}/x`, opts())
    ).resolves.toEqual({
      ok: false,
      reason: 'the host answered 503',
      retryable: true
    });
  });

  it('sends only its User-Agent: no cookie, no referer', async () => {
    let seen: http.IncomingHttpHeaders = {};
    const port = await serve((req, res) => {
      seen = req.headers;
      res.end(PNG);
    });
    await fetchRemote(`http://images.example:${port}/a.png`, opts());
    expect(seen['user-agent']).toBe('StellarImageImport/1.0 (+test)');
    expect(seen.cookie).toBeUndefined();
    expect(seen.referer).toBeUndefined();
    expect(seen.authorization).toBeUndefined();
  });

  it('refuses a host the guard refuses, without connecting', async () => {
    const result = await fetchRemote(
      'http://10.0.0.1/a.png',
      opts({ check: checkFor([]) })
    );
    expect(result).toEqual({
      ok: false,
      reason: "host '10.0.0.1' refused",
      retryable: false
    });
  });
});
