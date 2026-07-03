import type { Router } from 'express';
// Load first: registers the harness's jest.mock('../modules/config', ...) etc.
// so the direct route-module import below doesn't hit the real config module's
// requireEnv() and exit the process for a JWT secret this spec never uses.
import '../test/apiTestHarness';
import stylesheetRouter from '../routes/api/stylesheet';
import { registry } from './openapi';

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
