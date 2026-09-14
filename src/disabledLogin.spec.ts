/**
 * The disabled login names where to go (#622).
 *
 * A disabled member has no session, so the login `403` is the one place they
 * are sure to be standing. It carries the IRC channel staff reinstate in and a
 * public guide to reaching it, both read from `site` config. Its own file
 * rather than more of install-auth.spec.ts, which is already past the size
 * Codacy flags.
 */
import {
  request,
  app,
  prismaMock,
  bcryptMock,
  resetApiTestState
} from './test/apiTestHarness';
import { makeUser } from './test/factories';

describe('POST /api/auth — disabled account (#622)', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  it('answers 403 with the channel and the public IRC guide, msg unchanged', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: true })
    );

    const res = await request(app)
      .post('/api/auth')
      .send({ email: 'disabled@example.com', password: 'password123' });

    expect(res.status).toBe(403);
    // Values come from the harness's `site` config mock, never from literals in
    // the handler: the api single-sources them (ADR-0020).
    expect(res.body).toEqual({
      msg: 'Account disabled',
      disabledChannel: '#disabled',
      ircGuideUrl: 'https://kb.stellargra.ph/irc'
    });
  });

  it('never points a logged-out member at the in-app /irc route', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: true })
    );

    const res = await request(app)
      .post('/api/auth')
      .send({ email: 'disabled@example.com', password: 'password123' });

    // `/irc` is a UI route behind a session (#630); it would send them back here.
    expect(JSON.stringify(res.body)).not.toContain('"/irc"');
  });

  it('adds nothing to a wrong-password 400', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: false })
    );
    bcryptMock.compare.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/auth')
      .send({ email: 'member@example.com', password: 'wrong-password' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'Invalid credentials' });
  });
});
