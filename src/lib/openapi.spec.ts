import type { Router } from 'express';
// Load first: registers the harness's jest.mock('../modules/config', ...) etc.
// so the direct route-module import below doesn't hit the real config module's
// requireEnv() and exit the process for a JWT secret this spec never uses.
import '../test/apiTestHarness';
import stylesheetRouter from '../routes/api/stylesheet';
import {
  buildOpenApiDocument,
  msgResponse,
  registry,
  validationResponse
} from './openapi';
import { collectRoutes } from './expressRoutes';
import { isContractRoute, stripApi } from './openapiCompleteness';
import { createApp } from '../app';

/**
 * #198-class guard — a route can ship in routes/api/*.ts without ever being
 * registered in src/lib/openapi.ts: the manual registry gives no compile-time
 * or runtime signal that a route is missing, and the CI freshness gate only
 * re-diffs whatever IS in the registry against the last export. Both #175
 * (IRC nick-link) and #239 (AuthorStylesheet /css delivery) were exactly this
 * — the route worked, the contract just didn't know it existed. This walks a
 * router's mounted routes and fails if any lack a matching
 * `registry.registerPath()` entry, so the same class of gap can't reopen
 * silently for the routes covered here.
 *
 * Scoped to the stylesheet router (the site of #239) rather than the whole
 * app: a repo-wide walker would surface any pre-existing unrelated gaps as
 * failures here, which is a separate cleanup, not this guard's job.
 */
interface MountedRoute {
  method: string;
  path: string;
}

function mountedRoutes(router: Router, prefix: string): MountedRoute[] {
  const routes: MountedRoute[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    // Express `:id` params → OpenAPI `{id}` path-template syntax; the router's
    // own root ('/') contributes no suffix, matching how it's registered.
    const suffix =
      layer.route.path === '/'
        ? ''
        : layer.route.path.replace(/:(\w+)/g, '{$1}');
    const path = prefix + suffix;
    const methods = layer.route.methods as Record<string, boolean>;
    for (const method of Object.keys(methods)) {
      if (methods[method]) routes.push({ method, path });
    }
  }
  return routes;
}

describe('OpenAPI contract coverage — stylesheet router (#198-class guard)', () => {
  it('registers every mounted /stylesheet route in the OpenAPI contract', () => {
    const registered = new Set(
      registry.definitions
        .filter(
          (d): d is Extract<typeof d, { type: 'route' }> => d.type === 'route'
        )
        .map((d) => `${d.route.method} ${d.route.path}`)
    );

    const missing = mountedRoutes(stylesheetRouter, '/stylesheet').filter(
      (r) => !registered.has(`${r.method} ${r.path}`)
    );

    expect(missing).toEqual([]);
  });
});

/**
 * #562 — the helpers replaced 356 hand-written blocks, and the whole refactor
 * rests on them emitting exactly what those blocks said. That equivalence is
 * asserted here rather than left to the `openapi.json` freshness gate: the gate
 * would catch a regression, but only as a 356-operation JSON diff someone has
 * to interpret, and it cannot catch it at all if the document is regenerated in
 * the same commit. This fails first, and says what broke.
 *
 * The literal `$ref` is the contract, not an implementation detail — see the
 * helpers' own comment for why the registered Zod object cannot be substituted.
 */
describe('response helpers (#562)', () => {
  it('msgResponse emits the block the 293 call sites used to write', () => {
    expect(msgResponse('Report not found')).toEqual({
      description: 'Report not found',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MsgResponse' }
        }
      }
    });
  });

  it('validationResponse emits the block the 63 call sites used to write', () => {
    expect(validationResponse('Validation error')).toEqual({
      description: 'Validation error',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ValidationError' }
        }
      }
    });
  });
});

/**
 * #567 — the validation gate must not imply a credential.
 *
 * `securityForGates` returns `cookieAuth` for any gate it does not recognise as
 * non-credential, and 299 routes now carry a `validation` gate. #553 made
 * exactly this mistake with the site-wide write limiter and put a session
 * requirement on six public endpoints; `POST /auth/register` is the route its
 * comment names, so it is the one pinned here.
 */
describe('validation gates are not credentials (#567)', () => {
  // Same wiring as scripts/export-openapi.ts: the document's paths carry no
  // `/api` prefix, so the routes fed to the derivation must not either.
  const doc = buildOpenApiDocument(
    collectRoutes(createApp()).filter(isContractRoute).map(stripApi)
  ) as unknown as {
    paths: Record<
      string,
      Record<string, { security?: unknown; responses: Record<string, unknown> }>
    >;
  };

  it('leaves a public validated route with no security requirement', () => {
    const op = doc.paths['/auth/register'].post;
    expect(op.security).toBeUndefined();
  });

  it('still derives the 400 on that route', () => {
    const op = doc.paths['/auth/register'].post;
    expect(op.responses['400']).toBeDefined();
  });

  it('derives a 400 whose body is ValidationError, not MsgResponse', () => {
    // stellar-ui generates its service types from this document; MsgResponse
    // here would assert that `errors` does not exist.
    const op = doc.paths['/auth/sessions/{id}'].delete;
    expect(op.responses['400']).toEqual(
      validationResponse('Invalid path parameters')
    );
  });

  it('names every part of the request its validators cover', () => {
    const op = doc.paths['/users/{id}/irc-nick'].put;
    expect((op.responses['400'] as { description: string }).description).toBe(
      'Invalid path parameters or request body'
    );
  });

  // REGISTERED WINS, still. #567 deleted the 73 restatements that merely said
  // `Validation error`; the 5 bespoke and 19 MsgResponse registrations that say
  // something the middleware cannot are exactly what survived, and this pins
  // one of them.
  it('does not overwrite a registration that states its own 400', () => {
    const op = doc.paths['/auth'].post;
    expect((op.responses['400'] as { description: string }).description).toBe(
      'Invalid credentials'
    );
  });
});
