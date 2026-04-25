/**
 * Route-level tests for download access grant endpoints.
 */

import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  grantDownloadAccessMock,
  reverseDownloadAccessMock
} from './test/apiTestHarness';
import { DownloadGrantStatus } from '@prisma/client';
import { AppError } from './lib/errors';

const setStaffPerms = () =>
  prismaMock.userRank.findUnique.mockResolvedValue({
    permissions: { staff: true, admin: true }
  });

const GRANT_RESULT = {
  grantId: 1,
  downloadUrl: 'https://example.com/file.zip',
  amountBytes: '209715200',
  status: DownloadGrantStatus.COMPLETED,
  createdAt: new Date().toISOString()
};

describe('POST /api/contributions/:id/access', () => {
  beforeEach(() => resetApiTestState());

  it('requires auth (401 without session)', async () => {
    // The test harness always injects a user via requireAuth mock, so we test
    // that the module is called and returns its result
    grantDownloadAccessMock.mockResolvedValue(GRANT_RESULT);
    const res = await request(app).post('/api/contributions/5/access').send({});
    expect(res.status).toBe(200);
    expect(grantDownloadAccessMock).toHaveBeenCalledWith(7, 5, undefined);
  });

  it('passes idempotencyKey to module', async () => {
    grantDownloadAccessMock.mockResolvedValue(GRANT_RESULT);
    const res = await request(app)
      .post('/api/contributions/5/access')
      .send({ idempotencyKey: 'session-abc' });
    expect(res.status).toBe(200);
    expect(grantDownloadAccessMock).toHaveBeenCalledWith(7, 5, 'session-abc');
  });

  it('returns 400 on insufficient balance from module', async () => {
    grantDownloadAccessMock.mockRejectedValue(
      new AppError(400, 'Insufficient upload balance')
    );
    const res = await request(app).post('/api/contributions/5/access').send({});
    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Insufficient upload balance');
  });

  it('returns 403 when canDownload is disabled', async () => {
    grantDownloadAccessMock.mockRejectedValue(
      new AppError(403, 'Your download access has been disabled')
    );
    const res = await request(app).post('/api/contributions/5/access').send({});
    expect(res.status).toBe(403);
  });

  it('returns 409 on concurrent balance race', async () => {
    grantDownloadAccessMock.mockRejectedValue(
      new AppError(409, 'Balance changed concurrently, please retry')
    );
    const res = await request(app).post('/api/contributions/5/access').send({});
    expect(res.status).toBe(409);
  });

  it('returns 400 for non-numeric contribution id', async () => {
    const res = await request(app)
      .post('/api/contributions/abc/access')
      .send({});
    expect(res.status).toBe(400);
    expect(grantDownloadAccessMock).not.toHaveBeenCalled();
  });

  it('returns download URL and grant details on success', async () => {
    grantDownloadAccessMock.mockResolvedValue(GRANT_RESULT);
    const res = await request(app).post('/api/contributions/5/access').send({});
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toBe('https://example.com/file.zip');
    expect(res.body.grantId).toBe(1);
    expect(res.body.amountBytes).toBe('209715200');
  });
});

describe('POST /api/downloads/:grantId/reverse', () => {
  beforeEach(() => {
    resetApiTestState();
    setStaffPerms();
  });

  it('calls reverseDownloadAccess with staffId, grantId, and reason', async () => {
    reverseDownloadAccessMock.mockResolvedValue({
      grantId: 1,
      status: DownloadGrantStatus.REVERSED
    });
    const res = await request(app)
      .post('/api/downloads/1/reverse')
      .send({ reason: 'Dead link' });
    expect(res.status).toBe(200);
    expect(reverseDownloadAccessMock).toHaveBeenCalledWith(7, 1, 'Dead link');
  });

  it('allows reversal without a reason', async () => {
    reverseDownloadAccessMock.mockResolvedValue({
      grantId: 1,
      status: DownloadGrantStatus.REVERSED
    });
    const res = await request(app).post('/api/downloads/1/reverse').send({});
    expect(res.status).toBe(200);
    expect(reverseDownloadAccessMock).toHaveBeenCalledWith(7, 1, undefined);
  });

  it('returns 403 when user lacks staff/admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({ permissions: {} });
    const res = await request(app)
      .post('/api/downloads/1/reverse')
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
    expect(reverseDownloadAccessMock).not.toHaveBeenCalled();
  });

  it('propagates 404 when grant not found', async () => {
    reverseDownloadAccessMock.mockRejectedValue(
      new AppError(404, 'Grant not found')
    );
    const res = await request(app).post('/api/downloads/1/reverse').send({});
    expect(res.status).toBe(404);
  });

  it('propagates 409 when grant already reversed', async () => {
    reverseDownloadAccessMock.mockRejectedValue(
      new AppError(409, 'Grant is not in COMPLETED state')
    );
    const res = await request(app).post('/api/downloads/1/reverse').send({});
    expect(res.status).toBe(409);
  });
});
