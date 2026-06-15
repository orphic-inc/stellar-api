import {
  request,
  app,
  prismaMock,
  resetApiTestState
} from './test/apiTestHarness';

jest.mock('./modules/reputation', () => ({
  getReputation: jest.fn()
}));
import * as reputationModule from './modules/reputation';
const reputationMock = reputationModule as jest.Mocked<typeof reputationModule>;

// Matches the korin serviceKey in the harness config mock.
const SVC = 'Bearer test-service-key';

beforeEach(() => {
  resetApiTestState();
});

describe('GET /api/users/by-irc-nick/:nick (korin service)', () => {
  it('401 without the service key', async () => {
    const res = await request(app).get('/api/users/by-irc-nick/neo');
    expect(res.status).toBe(401);
  });

  it('401 with a wrong service key', async () => {
    const res = await request(app)
      .get('/api/users/by-irc-nick/neo')
      .set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  it('resolves a linked nick to {id, username, ircNick}', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'neo',
      ircNick: 'neo',
      disabled: false
    } as never);
    const res = await request(app)
      .get('/api/users/by-irc-nick/neo')
      .set('Authorization', SVC);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, username: 'neo', ircNick: 'neo' });
  });

  it('404 when no account is linked to the nick', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    const res = await request(app)
      .get('/api/users/by-irc-nick/ghost')
      .set('Authorization', SVC);
    expect(res.status).toBe(404);
  });

  it('404 when the matched account is disabled', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 9,
      username: 'banned',
      ircNick: 'banned',
      disabled: true
    } as never);
    const res = await request(app)
      .get('/api/users/by-irc-nick/banned')
      .set('Authorization', SVC);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/users/:id/reputation (korin service)', () => {
  it('401 without the service key', async () => {
    const res = await request(app).get('/api/users/7/reputation');
    expect(res.status).toBe(401);
  });

  it('returns the CRS for the id', async () => {
    reputationMock.getReputation.mockResolvedValue({
      score: 12,
      dimensions: []
    } as never);
    const res = await request(app)
      .get('/api/users/7/reputation')
      .set('Authorization', SVC);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ score: 12, dimensions: [] });
    expect(reputationMock.getReputation).toHaveBeenCalledWith(7);
  });
});
