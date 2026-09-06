// The app comes from the harness, not `createApp()` directly: importing the app
// tree pulls in isomorphic-dompurify, and the harness is where that (and the
// other heavy deps) are stubbed. It is the real route table either way.
import { app } from './test/apiTestHarness';
import { collectRoutes } from './lib/expressRoutes';
import { buildOpenApiDocument, securityForGates } from './lib/openapi';
import { isContractRoute, stripApi } from './lib/openapiCompleteness';

/**
 * `security` agrees with the middleware, for every operation (#520).
 *
 * The unit tests below assert the mapping function works, which was never the
 * problem — before this, `components.securitySchemes` was absent while 112
 * operations named schemes that did not exist, and 309 of 364 operations
 * disagreed with their own gates. Only walking the real app catches that.
 */
describe('securityForGates', () => {
  it('maps a service gate to serviceKey', () => {
    expect(securityForGates(['service'])).toEqual([{ serviceKey: [] }]);
  });

  it('maps auth and permission alike to cookieAuth', () => {
    // They present the same cookie. The difference between them is 401 vs 403,
    // which lives in `responses` — encoding it twice is how the two drift.
    expect(securityForGates(['auth'])).toEqual([{ cookieAuth: [] }]);
    expect(securityForGates(['permission'])).toEqual([{ cookieAuth: [] }]);
    expect(securityForGates(['auth', 'permission'])).toEqual([
      { cookieAuth: [] }
    ]);
  });

  it('prefers serviceKey when a route carries both', () => {
    expect(securityForGates(['auth', 'service'])).toEqual([{ serviceKey: [] }]);
  });

  it('yields nothing for an ungated route', () => {
    expect(securityForGates([])).toBeUndefined();
    expect(securityForGates(undefined)).toBeUndefined();
  });
});

describe('the built document', () => {
  const routes = collectRoutes(app).filter(isContractRoute).map(stripApi);
  const doc = buildOpenApiDocument(routes) as unknown as {
    components?: { securitySchemes?: Record<string, unknown> };
    paths: Record<
      string,
      Record<string, { security?: Record<string, unknown>[] }>
    >;
  };

  const declared = (method: string, path: string) =>
    doc.paths?.[path]?.[method.toLowerCase()]?.security
      ?.flatMap((b) => Object.keys(b))
      .join('+');

  it('defines every scheme it references', () => {
    const schemes = Object.keys(doc.components?.securitySchemes ?? {});
    expect(schemes.sort()).toEqual(['cookieAuth', 'serviceKey']);

    const referenced = new Set<string>();
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) {
        for (const block of op.security ?? []) {
          for (const name of Object.keys(block)) referenced.add(name);
        }
      }
    }
    // Before #520 this set was {bearerAuth, cookieAuth} and NEITHER existed.
    expect([...referenced].filter((n) => !schemes.includes(n))).toEqual([]);
  });

  it('agrees with the middleware on every single route', () => {
    const mismatches = routes
      .map((r) => {
        const expected = securityForGates(r.gates)
          ?.flatMap((b) => Object.keys(b))
          .join('+');
        const actual = declared(r.method, r.path);
        return actual === expected
          ? null
          : `${r.method} ${r.path}: gates ${JSON.stringify(r.gates)} expected ${expected ?? 'none'}, declared ${actual ?? 'none'}`;
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('declares serviceKey on the korin routes, and only those', () => {
    // The case that was exactly inverted: `bearerAuth` was declared on 70
    // cookie-gated routes and on none of the three that actually take a bearer
    // token. This is the highest-value single assertion in the file.
    const serviceRoutes = routes
      .filter((r) => r.gates?.includes('service'))
      .map((r) => `${r.method} ${r.path}`);
    expect(serviceRoutes.length).toBeGreaterThan(0);

    for (const r of serviceRoutes) {
      const [method, path] = r.split(' ');
      expect(declared(method, path)).toBe('serviceKey');
    }

    const withServiceKey = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([, op]) => op.security?.some((b) => 'serviceKey' in b))
        .map(([method]) => `${method.toUpperCase()} ${path}`)
    );
    expect(withServiceKey.sort()).toEqual(serviceRoutes.sort());
  });

  it('leaves genuinely public routes unsecured', () => {
    expect(declared('POST', '/auth')).toBeUndefined();
    expect(declared('POST', '/auth/register')).toBeUndefined();
    expect(declared('GET', '/version')).toBeUndefined();
  });
});
