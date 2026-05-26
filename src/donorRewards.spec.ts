import {
  request,
  app,
  resetApiTestState,
  donorMock
} from './test/apiTestHarness';
import { AppError } from './lib/errors';

beforeEach(() => resetApiTestState());

const mockSettings = {
  rewards: {
    iconMouseOverText: '',
    avatarMouseOverText: '',
    customIcon: 'https://example.com/icon.png',
    customIconLink: '',
    secondAvatar: '',
    profileInfo1: '',
    profileInfoTitle1: '',
    profileInfo2: '',
    profileInfoTitle2: '',
    profileInfo3: '',
    profileInfoTitle3: '',
    profileInfo4: '',
    profileInfoTitle4: ''
  },
  perks: { customIcon: true, forumTitle: true },
  forumTitle: { prefix: 'Gold', suffix: '', useComma: true }
};

// ─── GET /api/profile/me/donor-rewards ───────────────────────────────────────

describe('GET /api/profile/me/donor-rewards', () => {
  it('returns 404 when user has no active donor rank', async () => {
    donorMock.getDonorSettings.mockResolvedValue(null);
    const res = await request(app).get('/api/profile/me/donor-rewards');
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('No active donor rank');
  });

  it('returns 200 with rewards, perks, and forumTitle', async () => {
    donorMock.getDonorSettings.mockResolvedValue(mockSettings);
    const res = await request(app).get('/api/profile/me/donor-rewards');
    expect(res.status).toBe(200);
    expect(res.body.perks.customIcon).toBe(true);
    expect(res.body.forumTitle.prefix).toBe('Gold');
    expect(res.body.rewards.customIcon).toBe('https://example.com/icon.png');
  });

  it('returns forumTitle as null when perk is not enabled', async () => {
    donorMock.getDonorSettings.mockResolvedValue({
      ...mockSettings,
      perks: { customIcon: true },
      forumTitle: null
    });
    const res = await request(app).get('/api/profile/me/donor-rewards');
    expect(res.status).toBe(200);
    expect(res.body.forumTitle).toBeNull();
  });
});

// ─── PUT /api/profile/me/donor-rewards ───────────────────────────────────────

describe('PUT /api/profile/me/donor-rewards', () => {
  it('returns 400 on invalid URL for customIcon', async () => {
    const res = await request(app)
      .put('/api/profile/me/donor-rewards')
      .send({ customIcon: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated settings on success', async () => {
    donorMock.updateDonorRewards.mockResolvedValue(mockSettings);
    const res = await request(app)
      .put('/api/profile/me/donor-rewards')
      .send({ customIcon: 'https://example.com/new.png' });
    expect(res.status).toBe(200);
    expect(res.body.rewards).toBeDefined();
  });

  it('returns 403 when module throws AppError(403)', async () => {
    donorMock.updateDonorRewards.mockRejectedValue(
      new AppError(403, 'No active donor rank')
    );
    const res = await request(app)
      .put('/api/profile/me/donor-rewards')
      .send({ customIcon: '' });
    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('No active donor rank');
  });

  it('accepts empty string to clear a URL field', async () => {
    donorMock.updateDonorRewards.mockResolvedValue({
      ...mockSettings,
      rewards: { ...mockSettings.rewards, customIcon: '' }
    });
    const res = await request(app)
      .put('/api/profile/me/donor-rewards')
      .send({ customIcon: '' });
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/profile/me/donor-title ─────────────────────────────────────────

describe('PUT /api/profile/me/donor-title', () => {
  it('returns 200 with updated title on success', async () => {
    donorMock.updateDonorForumTitle.mockResolvedValue({
      prefix: 'VIP',
      suffix: '',
      useComma: true
    });
    const res = await request(app)
      .put('/api/profile/me/donor-title')
      .send({ prefix: 'VIP', useComma: true });
    expect(res.status).toBe(200);
    expect(res.body.prefix).toBe('VIP');
  });

  it('returns 403 when module throws AppError(403)', async () => {
    donorMock.updateDonorForumTitle.mockRejectedValue(
      new AppError(403, 'Forum title perk not enabled')
    );
    const res = await request(app)
      .put('/api/profile/me/donor-title')
      .send({ prefix: 'VIP' });
    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Forum title perk not enabled');
  });

  it('returns 400 when prefix exceeds max length', async () => {
    const res = await request(app)
      .put('/api/profile/me/donor-title')
      .send({ prefix: 'x'.repeat(65) });
    expect(res.status).toBe(400);
  });
});
