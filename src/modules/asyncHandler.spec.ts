import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asyncHandler } from './asyncHandler.js';
import { Request, Response, NextFunction } from 'express';

const mockReq = {} as Request;
const mockNext = vi.fn() as NextFunction;

const createMockRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('asyncHandler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should call the wrapped handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const res = createMockRes();
    wrapped(mockReq, res, mockNext);

    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledWith(mockReq, res, mockNext);
  });

  it('should catch errors and respond with status 500', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Test error'));
    const wrapped = asyncHandler(handler);

    const res = createMockRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wrapped(mockReq, res, mockNext);

    await vi.advanceTimersByTimeAsync(0);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Test error' });

    consoleSpy.mockRestore();
  });

  it('should handle timeout', async () => {
    const handler = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 20000))
      );
    const wrapped = asyncHandler(handler);

    const res = createMockRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wrapped(mockReq, res, mockNext);

    await vi.advanceTimersByTimeAsync(10000);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({ error: 'Request timeout' });

    consoleSpy.mockRestore();
  });
});
