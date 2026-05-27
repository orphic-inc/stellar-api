// Direct middleware spec for requirePermission and requireOwnerOrPermission.
// These tests exercise branches unreachable via route-level specs:
//   • requirePermission catch block (loadPermissions throws)
//   • requireOwnerOrPermission: owner pass-through, permission pass, denied, catch

import type { Request, Response, NextFunction, RequestHandler } from 'express';

const getUserRankAccessMock = jest.fn();

jest.mock('../lib/userRankAccess', () => ({
  getUserRankAccess: (...args: unknown[]) => getUserRankAccessMock(...args)
}));

const requireAuthMock = jest.fn(
  (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: unknown }).user = {
      id: 7,
      userRankId: 1,
      userRankLevel: 1000
    };
    next();
  }
);

jest.mock('./auth', () => ({
  requireAuth: (...args: Parameters<RequestHandler>) => requireAuthMock(...args)
}));

import { requirePermission, requireOwnerOrPermission } from './permissions';

// ─── helpers ──────────────────────────────────────────────────────────────────

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
  locals: Record<string, unknown>;
};

const makeReqRes = (userId = 7): [Request, MockRes, jest.Mock] => {
  const req = {
    user: { id: userId, userRankId: 1, userRankLevel: 1000 }
  } as unknown as Request;
  const res: MockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    locals: {}
  };
  const next = jest.fn();
  return [req, res, next];
};

// ─── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls next() when user has the required permission', async () => {
    getUserRankAccessMock.mockResolvedValue({
      permissions: { wiki_edit: true }
    });
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('wiki_edit');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(); // no error arg
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks the required permission', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: {} });
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('wiki_edit');
    await checkMw(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ msg: 'Permission denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('admin permission satisfies any delegated gate', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: { admin: true } });
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('rank_permissions_manage');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts any of multiple permissions (first match)', async () => {
    getUserRankAccessMock.mockResolvedValue({
      permissions: { forums_manage: true }
    });
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('admin', 'forums_manage');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not treat staff as an implicit login-watch permission', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: { staff: true } });
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('login_watch_view');
    await checkMw(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates errors from loadPermissions via next(err)', async () => {
    const dbError = new Error('DB connection lost');
    getUserRankAccessMock.mockRejectedValue(dbError);
    const [req, res, next] = makeReqRes();
    const [, checkMw] = requirePermission('admin');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── requireOwnerOrPermission ─────────────────────────────────────────────────

describe('requireOwnerOrPermission', () => {
  beforeEach(() => jest.clearAllMocks());

  const getOwnerId = (req: Request) =>
    (req as unknown as { ownerId: number }).ownerId;

  it('calls next() when the requester is the owner', async () => {
    const [req, res, next] = makeReqRes(7);
    (req as unknown as { ownerId: number }).ownerId = 7;
    const [, checkMw] = requireOwnerOrPermission(getOwnerId, 'admin');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(getUserRankAccessMock).not.toHaveBeenCalled();
  });

  it('calls next() when user has the required permission (non-owner)', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: { admin: true } });
    const [req, res, next] = makeReqRes(7);
    (req as unknown as { ownerId: number }).ownerId = 99; // different owner
    const [, checkMw] = requireOwnerOrPermission(getOwnerId, 'admin');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 403 when non-owner lacks permission', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: {} });
    const [req, res, next] = makeReqRes(7);
    (req as unknown as { ownerId: number }).ownerId = 99;
    const [, checkMw] = requireOwnerOrPermission(getOwnerId, 'admin');
    await checkMw(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ msg: 'Permission denied' });
  });

  it('propagates errors via next(err)', async () => {
    const dbError = new Error('DB down');
    getUserRankAccessMock.mockRejectedValue(dbError);
    const [req, res, next] = makeReqRes(7);
    (req as unknown as { ownerId: number }).ownerId = 99;
    const [, checkMw] = requireOwnerOrPermission(getOwnerId, 'admin');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(dbError);
  });

  it('treats null ownerId as non-owner and falls through to permission check', async () => {
    getUserRankAccessMock.mockResolvedValue({ permissions: { admin: true } });
    const getOwnerNull = (_req: Request) => null;
    const [req, res, next] = makeReqRes(7);
    const [, checkMw] = requireOwnerOrPermission(getOwnerNull, 'admin');
    await checkMw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ─── TtlCache (lib/ttlCache.ts) ───────────────────────────────────────────────
// Tested here to avoid a separate spec file for a tiny utility.
import { TtlCache } from '../lib/ttlCache';

describe('TtlCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new TtlCache();
    expect(cache.get('nope')).toBeUndefined();
  });

  it('returns the value before TTL expires', () => {
    const cache = new TtlCache();
    cache.set('k', 'value', 60_000);
    expect(cache.get<string>('k')).toBe('value');
  });

  it('returns undefined and evicts the key after TTL expires', () => {
    const cache = new TtlCache();
    cache.set('k', 'stale', 1);
    // Manually backdate expiry by using a very short TTL and sleeping
    const privateStore = (
      cache as unknown as {
        store: Map<string, { expiresAt: number; value: unknown }>;
      }
    ).store;
    const entry = privateStore.get('k')!;
    entry.expiresAt = Date.now() - 1;
    expect(cache.get('k')).toBeUndefined();
    expect(privateStore.has('k')).toBe(false);
  });

  it('delete removes the key', () => {
    const cache = new TtlCache();
    cache.set('k', 42, 60_000);
    cache.delete('k');
    expect(cache.get('k')).toBeUndefined();
  });
});
