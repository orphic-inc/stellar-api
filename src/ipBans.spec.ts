import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const setIpBanManager = () =>
  setCurrentUserPermissions(
    makeUserRank({
      ip_bans_manage: true
    }).permissions as Record<string, boolean>
  );

beforeEach(() => resetApiTestState());

describe('POST /api/ip-bans', () => {
  it('requires ip_bans_manage permission', async () => {
    const res = await request(app).post('/api/ip-bans').send({
      fromIp: '1.2.3.4'
    });

    expect(res.status).toBe(403);
  });

  it('rejects invalid IPv4 octets', async () => {
    setIpBanManager();

    const res = await request(app).post('/api/ip-bans').send({
      fromIp: '999.2.3.4'
    });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Validation failed');
  });

  it('rejects inverted ranges', async () => {
    setIpBanManager();

    const res = await request(app).post('/api/ip-bans').send({
      fromIp: '10.0.0.10',
      toIp: '10.0.0.1'
    });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Validation failed');
  });

  it('stores valid ranges and serializes them back to dotted IPv4', async () => {
    setIpBanManager();
    prismaMock.ipBan.create.mockResolvedValue({
      id: 5,
      fromIp: 167772161,
      toIp: 167772170
    } as never);

    const res = await request(app).post('/api/ip-bans').send({
      fromIp: '10.0.0.1',
      toIp: '10.0.0.10'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.ipBan.create).toHaveBeenCalledWith({
      data: { fromIp: 167772161, toIp: 167772170 }
    });
    expect(res.body).toEqual({
      id: 5,
      fromIp: '10.0.0.1',
      toIp: '10.0.0.10'
    });
  });
});
