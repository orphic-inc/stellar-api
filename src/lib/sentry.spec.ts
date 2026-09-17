import type { ErrorEvent, EventHint } from '@sentry/node';
import {
  scrubFeedToken,
  sentryBeforeSend,
  userContextFromRequest
} from './sentry';
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

describe('scrubFeedToken (#262)', () => {
  // A Member Feed URL carries a bearer credential in its query string.
  const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const withRequest = (request: ErrorEvent['request']) =>
    ({ event_id: 'evt', request }) as ErrorEvent;

  it('redacts the token from the URL and keeps every other parameter', () => {
    const out = scrubFeedToken(
      withRequest({
        url: `https://s.test/api/feeds/contributions.xml?user=9&token=${TOKEN}&tag=jazz`
      })
    );
    expect(out.request?.url).toBe(
      'https://s.test/api/feeds/contributions.xml?user=9&token=[redacted]&tag=jazz'
    );
  });

  it('redacts a token that leads the query', () => {
    const out = scrubFeedToken(
      withRequest({ url: `https://s.test/api/feeds/news.xml?token=${TOKEN}` })
    );
    expect(out.request?.url).toBe(
      'https://s.test/api/feeds/news.xml?token=[redacted]'
    );
  });

  it.each([
    ['a string', `user=9&token=${TOKEN}`, 'user=9&token=[redacted]'],
    [
      'an object',
      { user: '9', token: TOKEN },
      { user: '9', token: '[redacted]' }
    ],
    [
      'pairs',
      [
        ['user', '9'],
        ['token', TOKEN]
      ],
      [
        ['user', '9'],
        ['token', '[redacted]']
      ]
    ]
  ])(
    'redacts the token from a query string given as %s',
    (_shape, query, expected) => {
      const out = scrubFeedToken(withRequest({ query_string: query as never }));
      expect(out.request?.query_string).toEqual(expected);
    }
  );

  it('leaves a parameter that merely ends in "token" alone', () => {
    const out = scrubFeedToken(
      withRequest({ url: 'https://s.test/x?csrftoken=keep&user=9' })
    );
    expect(out.request?.url).toBe('https://s.test/x?csrftoken=keep&user=9');
  });

  it('runs on every event sentryBeforeSend keeps', () => {
    const event = withRequest({
      url: `https://s.test/api/feeds/mine.xml?user=9&token=${TOKEN}`
    });
    const hint = { originalException: new TypeError('boom') };
    expect(
      sentryBeforeSend(event, hint as EventHint)?.request?.url
    ).not.toContain(TOKEN);
  });
});
