/**
 * Service-level unit tests for the korin ledger client (ADR-0016).
 */

import { RatioExempt, DownloadGrantStatus } from '@prisma/client';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mutable so tests can toggle "korin configured" vs "inert".
const mockKorin = {
  apiUrl: '',
  pullKey: '',
  pollIntervalMs: 300_000,
  serviceKey: ''
};
jest.mock('./config', () => ({ korin: mockKorin }));

jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

const mockGrantFindMany = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: { downloadAccessGrant: { findMany: mockGrantFindMany } }
}));

import {
  resolveDeltas,
  buildConsumptionEvent,
  pushConsumptionEvent,
  checkCanConsume,
  getNewConsumptionEvents
} from './ledger';

const mockFetch = jest.fn();

beforeEach(() => {
  mockKorin.apiUrl = '';
  mockKorin.pullKey = '';
  mockFetch.mockReset();
  mockGrantFindMany.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

const withKorin = (): void => {
  mockKorin.apiUrl = 'http://korin.test';
  mockKorin.pullKey = 'pull-secret';
};

// ─── resolveDeltas ─────────────────────────────────────────────────────────

describe('resolveDeltas', () => {
  const bytes = 1_000_000n;

  it('NONE debits and credits the full amount', () => {
    expect(resolveDeltas(bytes, RatioExempt.NONE)).toEqual({
      consumedDelta: bytes,
      contributedDelta: bytes,
      pass: 'none'
    });
  });

  it('FREEPASS zeroes the consumer debit, keeps the contributor credit', () => {
    expect(resolveDeltas(bytes, RatioExempt.FREEPASS)).toEqual({
      consumedDelta: 0n,
      contributedDelta: bytes,
      pass: 'freepass'
    });
  });

  it('NEUTRALPASS zeroes both sides', () => {
    expect(resolveDeltas(bytes, RatioExempt.NEUTRALPASS)).toEqual({
      consumedDelta: 0n,
      contributedDelta: 0n,
      pass: 'neutralpass'
    });
  });
});

// ─── buildConsumptionEvent ───────────────────────────────────────────────────

describe('buildConsumptionEvent', () => {
  const src = {
    id: 42,
    consumerId: 7,
    contributorId: 99,
    contributionId: 5,
    amountBytes: 1_000_000n,
    ratioExempt: RatioExempt.NONE,
    at: new Date('2026-07-13T00:00:00.000Z')
  };

  it('maps a grant event with positive deltas and BigInt-as-string', () => {
    expect(buildConsumptionEvent(src, 'grant')).toEqual({
      grantId: 42,
      kind: 'grant',
      userId: 7,
      contributorId: 99,
      contributionId: 5,
      consumedDelta: '1000000',
      contributedDelta: '1000000',
      pass: 'none',
      at: '2026-07-13T00:00:00.000Z'
    });
  });

  it('negates deltas for a reversal', () => {
    const ev = buildConsumptionEvent(src, 'reversal');
    expect(ev.kind).toBe('reversal');
    expect(ev.consumedDelta).toBe('-1000000');
    expect(ev.contributedDelta).toBe('-1000000');
  });

  it('a FREEPASS reversal only negates the contributor side (consumer never accrued)', () => {
    const ev = buildConsumptionEvent(
      { ...src, ratioExempt: RatioExempt.FREEPASS },
      'reversal'
    );
    expect(ev.consumedDelta).toBe('0');
    expect(ev.contributedDelta).toBe('-1000000');
    expect(ev.pass).toBe('freepass');
  });
});

// ─── pushConsumptionEvent ────────────────────────────────────────────────────

describe('pushConsumptionEvent', () => {
  const event = buildConsumptionEvent(
    {
      id: 1,
      consumerId: 7,
      contributorId: 99,
      contributionId: 5,
      amountBytes: 1000n,
      ratioExempt: RatioExempt.NONE,
      at: new Date()
    },
    'grant'
  );

  it('returns false without calling fetch when korin is unconfigured', async () => {
    expect(await pushConsumptionEvent(event)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs with the x-pull-key header and returns true on 2xx', async () => {
    withKorin();
    mockFetch.mockResolvedValue({ ok: true });
    expect(await pushConsumptionEvent(event)).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://korin.test/ledger/consumption');
    expect(init.method).toBe('POST');
    expect(init.headers['x-pull-key']).toBe('pull-secret');
  });

  it('returns false on a non-2xx response', async () => {
    withKorin();
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    expect(await pushConsumptionEvent(event)).toBe(false);
  });

  it('returns false on a network error', async () => {
    withKorin();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await pushConsumptionEvent(event)).toBe(false);
  });
});

// ─── checkCanConsume ─────────────────────────────────────────────────────────

describe('checkCanConsume', () => {
  it('returns null (fail-open) without calling fetch when korin is unconfigured', async () => {
    expect(await checkCanConsume(7, 5)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the verdict on 2xx', async () => {
    withKorin();
    const verdict = { allow: false, reason: 'LEECH_DISABLED' };
    mockFetch.mockResolvedValue({ ok: true, json: async () => verdict });
    expect(await checkCanConsume(7, 5)).toEqual(verdict);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(
      '/ledger/can-consume?userId=7&contributionId=5'
    );
  });

  it('returns null (fail-open) on a non-2xx response', async () => {
    withKorin();
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await checkCanConsume(7, 5)).toBeNull();
  });

  it('returns null (fail-open) on timeout / network error', async () => {
    withKorin();
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await checkCanConsume(7, 5)).toBeNull();
  });
});

// ─── getNewConsumptionEvents ─────────────────────────────────────────────────

describe('getNewConsumptionEvents', () => {
  it('maps COMPLETED grants after the cursor into grant events', async () => {
    mockGrantFindMany.mockResolvedValue([
      {
        id: 10,
        consumerId: 7,
        contributorId: 99,
        contributionId: 5,
        amountBytes: 2000n,
        ratioExempt: RatioExempt.FREEPASS,
        createdAt: new Date('2026-07-13T00:00:00.000Z')
      }
    ]);

    const events = await getNewConsumptionEvents(9);

    expect(mockGrantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { gt: 9 }, status: DownloadGrantStatus.COMPLETED },
        orderBy: { id: 'asc' }
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      grantId: 10,
      kind: 'grant',
      consumedDelta: '0', // FREEPASS suppresses the consumer side
      contributedDelta: '2000',
      pass: 'freepass'
    });
  });
});
