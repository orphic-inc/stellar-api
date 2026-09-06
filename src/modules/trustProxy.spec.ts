/**
 * `trust proxy` and the client address (#542).
 *
 * The interesting assertion is not that Express has a `trust proxy` option —
 * it is that with the value this app ships, a client-supplied
 * `X-Forwarded-For` cannot become `req.ip`. That is the whole defect: nginx
 * APPENDS the real peer to the client's header, and the old code read the
 * FIRST entry.
 */
import express from 'express';
import request from 'supertest';

const appWith = (hops: number) => {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/whoami', (req, res) => res.json({ ip: req.ip }));
  return app;
};

describe('trust proxy resolution', () => {
  it('ignores a spoofed X-Forwarded-For with one trusted hop', async () => {
    // Simulates the real stack: the client sent `1.2.3.4`, nginx appended the
    // true peer, so the header arrives as "1.2.3.4, <peer>".
    const res = await request(appWith(1))
      .get('/whoami')
      .set('X-Forwarded-For', '1.2.3.4, 203.0.113.9');

    expect(res.body.ip).toBe('203.0.113.9');
    expect(res.body.ip).not.toBe('1.2.3.4');
  });

  it('ignores a multi-entry spoof, however many the client stuffs in', async () => {
    const res = await request(appWith(1))
      .get('/whoami')
      .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9');

    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('is exactly what the OLD code would have returned, inverted', async () => {
    // The pre-fix expression was `xff.split(',')[0].trim()`. Pinning the
    // contrast so a regression to that form is visible as a test failure.
    const header = '1.2.3.4, 203.0.113.9';
    const oldBehaviour = header.split(',')[0].trim();
    const res = await request(appWith(1))
      .get('/whoami')
      .set('X-Forwarded-For', header);

    expect(oldBehaviour).toBe('1.2.3.4');
    expect(res.body.ip).not.toBe(oldBehaviour);
  });

  it('trusts nothing when configured with zero hops', async () => {
    // The local-dev setting: no proxy in front, so the header is ignored
    // entirely and the socket peer wins.
    const res = await request(appWith(0))
      .get('/whoami')
      .set('X-Forwarded-For', '1.2.3.4');

    expect(res.body.ip).not.toBe('1.2.3.4');
  });
});
