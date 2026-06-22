/**
 * Unit tests for install state: the pure barrier decision (`gate`) and the
 * read-port that maps the recorded `SiteSettings.installedAt` fact into the
 * typed `InstallState` union. DB is mocked.
 */

const mockSiteSettings = {
  findUnique: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: { siteSettings: mockSiteSettings }
}));

import {
  gate,
  getInstallState,
  isInstalled,
  __resetInstallStateCache,
  type InstallState
} from './installState';

beforeEach(() => {
  jest.clearAllMocks();
  __resetInstallStateCache();
});

describe('gate (pure barrier decision)', () => {
  it('blocks while awaiting setup', () => {
    expect(gate({ phase: 'awaiting_setup' })).toBe('block');
  });

  it('passes once installed', () => {
    const state: InstallState = {
      phase: 'installed',
      installedAt: new Date('2026-06-22T00:00:00Z')
    };
    expect(gate(state)).toBe('pass');
  });
});

describe('getInstallState (recorded fact → typed union)', () => {
  it('maps a null installedAt to awaiting_setup', async () => {
    mockSiteSettings.findUnique.mockResolvedValue({ id: 1, installedAt: null });

    const state = await getInstallState();

    expect(state).toEqual({ phase: 'awaiting_setup' });
  });

  it('maps a missing settings row to awaiting_setup', async () => {
    mockSiteSettings.findUnique.mockResolvedValue(null);

    const state = await getInstallState();

    expect(state).toEqual({ phase: 'awaiting_setup' });
  });

  it('maps a stamped installedAt to installed, carrying the date', async () => {
    const installedAt = new Date('2026-06-22T12:00:00Z');
    mockSiteSettings.findUnique.mockResolvedValue({ id: 1, installedAt });

    const state = await getInstallState();

    expect(state).toEqual({ phase: 'installed', installedAt });
  });

  it('caches the installed result — never re-queries once installed', async () => {
    mockSiteSettings.findUnique.mockResolvedValue({
      id: 1,
      installedAt: new Date()
    });

    await getInstallState();
    await getInstallState();

    expect(mockSiteSettings.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not cache the negative — re-queries while awaiting setup', async () => {
    mockSiteSettings.findUnique.mockResolvedValue({ id: 1, installedAt: null });

    await getInstallState();
    await getInstallState();

    expect(mockSiteSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('isInstalled (boolean adapter over the gate)', () => {
  it('is false while awaiting setup', async () => {
    mockSiteSettings.findUnique.mockResolvedValue({ id: 1, installedAt: null });
    expect(await isInstalled()).toBe(false);
  });

  it('is true once installedAt is stamped', async () => {
    mockSiteSettings.findUnique.mockResolvedValue({
      id: 1,
      installedAt: new Date()
    });
    expect(await isInstalled()).toBe(true);
  });
});
