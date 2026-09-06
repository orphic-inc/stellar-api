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
      fromIp: '00000000000000000000ffff0a000001',
      toIp: '00000000000000000000ffff0a00000a'
    } as never);

    const res = await request(app).post('/api/ip-bans').send({
      fromIp: '10.0.0.1',
      toIp: '10.0.0.10'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.ipBan.create).toHaveBeenCalledWith({
      data: {
        // Normalised bounds: 32 hex chars, IPv4 mapped into ::ffff:0:0/96.
        // Previously two signed Ints, which could not order across
        // 127.255.255.255 and could not hold IPv6 at all (#540).
        fromIp: '00000000000000000000ffff0a000001',
        toIp: '00000000000000000000ffff0a00000a'
      }
    });
    expect(res.body).toEqual({
      id: 5,
      fromIp: '10.0.0.1',
      toIp: '10.0.0.10'
    });
  });
});
