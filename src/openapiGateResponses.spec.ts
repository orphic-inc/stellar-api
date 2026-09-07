import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Loaded first for its mocks: importing the openapi module pulls the route
// tree, and with it isomorphic-dompurify and the real config's requireEnv().
import './test/apiTestHarness';
import { buildOpenApiDocument, responsesForGates } from './lib/openapi';
import type { Operation } from './lib/openapiCompleteness';

/**
 * The gate-implied `401`/`403`, derived rather than hand-written (#517).
 *
 * THIS FILE REPLACES A GATE. `openapi:auth-coverage` (#494) existed to police
 * 495 hand-written blocks, and those blocks now come from the same gates the
 * checker read — so it had become an assertion about the generator's own
 * input. #520 made this move for `security` and left
 * `src/openapiSecurity.spec.ts` behind; this is its sibling.
 *
 * WHAT IT DOES NOT DO, deliberately: re-read the middleware. The harness mocks
 * `requireAuth` away, so 214 of the 356 gated routes carry no stamp here and
 * an app-walking assertion would pass on a route table that is not the real
 * one. The real chain is read by the export script, and the committed
 * `openapi.json` it produces is asserted below.
 */
describe('responsesForGates', () => {
  const description = (
    responses: Record<string, { description: string }>,
    code: string
  ) => responses[code]?.description;

  it('describes an auth gate as an unauthenticated caller meets it', () => {
    const r = responsesForGates([{ kind: 'auth' }]);
    expect(Object.keys(r)).toEqual(['401']);
    expect(description(r, '401')).toBe('Not authenticated');
  });

  it('gives a permission gate both codes, because it is both checks', () => {
    // `requirePermission()` spreads [requireAuth, check]: an anonymous caller
    // is refused by the first element and an authenticated one without the
    // permission by the second. Declaring only 403 describes half the gate.
    const r = responsesForGates([
      { kind: 'permission', permissions: ['news_manage'] }
    ]);
    expect(Object.keys(r).sort()).toEqual(['401', '403']);
    expect(description(r, '403')).toBe('Missing news_manage');
  });

  it('joins alternative permissions with "or", never "and"', () => {
    // ANY of them satisfies the gate — `requirePermission` spreads its varargs
    // into a `.some()`. "and" would describe a route nobody can reach.
    const r = responsesForGates([
      { kind: 'permission', permissions: ['wiki_manage', 'admin'] }
    ]);
    expect(description(r, '403')).toBe('Missing wiki_manage or admin');
  });

  it('names no permission when the gate names none', () => {
    // `requireOwnerOrPermission` stamps its kind alone: an owner passes it
    // WITHOUT the permission, so naming one would put a requirement in the
    // contract that is not one.
    const r = responsesForGates([{ kind: 'permission' }]);
    expect(description(r, '403')).toBe('Permission denied');
  });

  it('calls a service-key failure what it is', () => {
    // The key rides in an Authorization header, so a missing or wrong one is
    // an authentication failure — 401, not 403.
    const r = responsesForGates([{ kind: 'service' }]);
    expect(Object.keys(r)).toEqual(['401']);
    expect(description(r, '401')).toBe('Missing or wrong service key');
  });

  it('yields nothing for an ungated route', () => {
    expect(responsesForGates([])).toEqual({});
    expect(responsesForGates(undefined)).toEqual({});
  });
});

/**
 * The injection itself, driven by gates this file supplies.
 *
 * `buildOpenApiDocument` takes the route table as an argument, so a fabricated
 * gate on a real path exercises the merge without depending on what the
 * harness left standing in the middleware.
 */
describe('buildOpenApiDocument', () => {
  const build = (routes: Operation[]) =>
    buildOpenApiDocument(routes) as unknown as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, { description?: string }> }>
      >;
    };

  const responsesFor = (routes: Operation[], method: string, path: string) =>
    build(routes).paths?.[path]?.[method.toLowerCase()]?.responses ?? {};

  it('fills a code the registration omits', () => {
    // `GET /version` registers a 200 and nothing else.
    const responses = responsesFor(
      [
        {
          method: 'GET',
          path: '/version',
          gates: [{ kind: 'permission', permissions: ['admin'] }]
        }
      ],
      'GET',
      '/version'
    );

    expect(responses['401']?.description).toBe('Not authenticated');
    expect(responses['403']?.description).toBe('Missing admin');
  });

  it('lets a registration win over the code it would derive', () => {
    // REGISTERED WINS is what keeps the two deliberate overrides alive:
    // `GET /asset/{hash}` explains why an asset read needs a session at all,
    // and `POST /reports/{id}/unclaim` folds gate and handler into one entry
    // because a caller cannot tell its two 403s apart. `POST /auth` stands in
    // for them here — it registers a handler-thrown 403 and carries no gate.
    const responses = responsesFor(
      [
        {
          method: 'POST',
          path: '/auth',
          gates: [{ kind: 'permission', permissions: ['admin'] }]
        }
      ],
      'POST',
      '/auth'
    );

    expect(responses['403']?.description).toBe('Account disabled');
    expect(responses['401']?.description).toBe('Not authenticated');
  });

  it('adds no failure code to an ungated route', () => {
    const responses = responsesFor(
      [{ method: 'GET', path: '/version', gates: [] }],
      'GET',
      '/version'
    );

    expect(responses['401']).toBeUndefined();
    expect(responses['403']).toBeUndefined();
  });

  it('keeps response codes in ascending order', () => {
    // Appending the derived codes instead would reorder `openapi.json` for
    // 356 operations and bury every real change in the noise.
    const codes = Object.keys(
      responsesFor(
        [
          {
            method: 'GET',
            path: '/version',
            gates: [{ kind: 'permission', permissions: ['admin'] }]
          }
        ],
        'GET',
        '/version'
      )
    );

    expect(codes).toEqual([...codes].sort((a, b) => Number(a) - Number(b)));
  });
});

/**
 * The shipped contract, read off disk.
 *
 * This is the artefact the REAL app produced: `npm run openapi:export` builds
 * it from `createApp()`, and CI re-runs that and fails on any diff. So it is
 * the one place in a spec file where the real middleware chain is observable,
 * and `security` is the observation — it is derived from the same gates.
 *
 * The invariant #494 measured, restated over that: a credential in `security`
 * means the operation documents the failure that credential can produce.
 */
describe('the committed openapi.json', () => {
  const doc = JSON.parse(
    readFileSync(resolve(__dirname, '../openapi.json'), 'utf8')
  ) as {
    paths: Record<
      string,
      Record<
        string,
        {
          security?: Record<string, unknown>[];
          responses?: Record<string, { description?: string }>;
        }
      >
    >;
  };

  const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({
      key: `${method.toUpperCase()} ${path}`,
      schemes: (op.security ?? []).flatMap((block) => Object.keys(block)),
      responses: op.responses ?? {}
    }))
  );

  it('documents a 401 wherever it names a credential', () => {
    const gaps = operations
      .filter((op) => op.schemes.length > 0 && !op.responses['401'])
      .map((op) => op.key);

    expect(gaps).toEqual([]);
  });

  it('documents no 401 where it names none', () => {
    // The other direction, and the one that would catch a 401 left behind by
    // the block deletion on a route whose gate has since gone.
    const orphans = operations
      .filter((op) => op.schemes.length === 0 && op.responses['401'])
      .map((op) => op.key);

    expect(orphans).toEqual([]);
  });

  it('words the service-key 401 differently from the session one', () => {
    // The distinction #520 found inverted: `bearerAuth` was declared on 70
    // cookie-gated routes and on none of the three that take a bearer token.
    const service = operations.filter((op) =>
      op.schemes.includes('serviceKey')
    );
    expect(service.length).toBeGreaterThan(0);

    for (const op of service) {
      expect(op.responses['401']?.description).toBe(
        'Missing or wrong service key'
      );
    }

    const cookieOnly = operations.filter(
      (op) =>
        op.schemes.includes('cookieAuth') && !op.schemes.includes('serviceKey')
    );
    for (const op of cookieOnly) {
      expect(op.responses['401']?.description).not.toBe(
        'Missing or wrong service key'
      );
    }
  });

  it('never says "Missing <permission>" without a credential to miss', () => {
    // A `Missing x` 403 is a permission gate's wording. One on an operation
    // with no `security` block would mean the two axes had drifted apart —
    // which is the whole condition #520 found on 309 of 364 operations.
    const stray = operations
      .filter(
        (op) =>
          op.schemes.length === 0 &&
          /^Missing /.test(op.responses['403']?.description ?? '')
      )
      .map((op) => op.key);

    expect(stray).toEqual([]);
  });
});
