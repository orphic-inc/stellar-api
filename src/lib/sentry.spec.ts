import type { ErrorEvent, EventHint } from '@sentry/node';
import { sentryBeforeSend, userContextFromRequest } from './sentry';
import { AppError } from './errors';

const event = { event_id: 'evt' } as ErrorEvent;

describe('sentryBeforeSend', () => {
  it('drops operational AppErrors (statusCode < 500)', () => {
    const hint = { originalException: new AppError(404, 'Not found') };
    expect(sentryBeforeSend(event, hint as EventHint)).toBeNull();
  });

  it('keeps server-error AppErrors (statusCode >= 500)', () => {
    const hint = { originalException: new AppError(500, 'Boom') };
    expect(sentryBeforeSend(event, hint as EventHint)).toBe(event);
  });

  it('keeps unexpected (non-AppError) exceptions', () => {
    const hint = { originalException: new TypeError('undefined is not a fn') };
    expect(sentryBeforeSend(event, hint as EventHint)).toBe(event);
  });
});

describe('userContextFromRequest', () => {
  it('maps an authenticated request to a Sentry user payload', () => {
    const req = { user: { id: 7, userRankId: 2, userRankLevel: 100 } };
    expect(userContextFromRequest(req)).toEqual({
      id: '7',
      userRankId: 2,
      userRankLevel: 100
    });
  });

  it('returns null when there is no authenticated user', () => {
    expect(userContextFromRequest({})).toBeNull();
  });
});
