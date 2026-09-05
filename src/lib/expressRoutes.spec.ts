import express, { Router, type Express } from 'express';

import { collectRoutes } from './expressRoutes';
import { markGate } from './routeGate';

// These tests exist because collectRoutes reads Express 4 internals (`_router`,
// `layer.regexp`, `layer.keys`), which are not public API. An Express upgrade
// that changes their shape must fail HERE — loudly and specifically — rather
// than silently reporting zero routes and turning the #474 completeness gate
// into a no-op that passes forever.

const paths = (app: Express) =>
  collectRoutes(app)
    .map((r) => `${r.method} ${r.path}`)
    .sort();

describe('collectRoutes', () => {
  it('reads a route declared directly on the app', () => {
    const app = express();
    app.get('/health', (_req, res) => res.json({}));

    expect(paths(app)).toEqual(['GET /health']);
  });

  it('prefixes routes with their mount path', () => {
    const app = express();
    const users = Router();
    users.get('/', (_req, res) => res.json({}));
    users.post('/', (_req, res) => res.json({}));
    app.use('/api/users', users);

    expect(paths(app)).toEqual(['GET /api/users', 'POST /api/users']);
  });

  it('converts :params to {param} the way openapi.json writes them', () => {
    const app = express();
    const r = Router();
    r.get('/:id/warnings', (_req, res) => res.json({}));
    app.use('/api/users', r);

    expect(paths(app)).toEqual(['GET /api/users/{id}/warnings']);
  });

  // The regression this file is really for. Express compiles a parameterised
  // mount to `(?:\/([^/]+?))` — the slash lives INSIDE the group and `[^/]` is
  // unescaped. An extraction that assumes `(?:([^\/]+?))` leaves raw regex in
  // the path, which then reads as an unregistered route and inflates the count.
  it('rebuilds a mount path that carries its own :param', () => {
    const app = express();
    const dnc = Router();
    dnc.get('/', (_req, res) => res.json({}));
    dnc.delete('/:dncId', (_req, res) => res.json({}));
    app.use('/api/communities/:communityId/dnc', dnc);

    expect(paths(app)).toEqual([
      'DELETE /api/communities/{communityId}/dnc/{dncId}',
      'GET /api/communities/{communityId}/dnc'
    ]);
  });

  it('never leaves regex fragments in a path', () => {
    const app = express();
    const r = Router();
    r.get('/:sub', (_req, res) => res.json({}));
    app.use('/api/a/:one/b/:two/c', r);

    for (const { path } of collectRoutes(app)) {
      // Braces are legitimate here ({one}); regex punctuation and an EMPTY
      // pair are not — an empty {} means a param name was lost.
      expect(path).not.toMatch(/[()[\]^\\?+*]/);
      expect(path).not.toContain('{}');
    }
    expect(paths(app)).toEqual(['GET /api/a/{one}/b/{two}/c/{sub}']);
  });

  it('walks routers mounted inside routers', () => {
    const app = express();
    const inner = Router();
    inner.get('/posts', (_req, res) => res.json({}));
    const outer = Router();
    outer.use('/:topicId', inner);
    app.use('/api/forums', outer);

    expect(paths(app)).toEqual(['GET /api/forums/{topicId}/posts']);
  });

  it('reports every method on one path separately', () => {
    const app = express();
    const r = Router();
    r.route('/:id')
      .get((_req, res) => res.json({}))
      .put((_req, res) => res.json({}))
      .delete((_req, res) => res.json({}));
    app.use('/api/items', r);

    expect(paths(app)).toEqual([
      'DELETE /api/items/{id}',
      'GET /api/items/{id}',
      'PUT /api/items/{id}'
    ]);
  });

  it('ignores plain middleware, which serves no route', () => {
    const app = express();
    app.use((_req, _res, next) => next());
    app.use('/api', (_req, _res, next) => next());
    app.get('/only', (_req, res) => res.json({}));

    expect(paths(app)).toEqual(['GET /only']);
  });

  it('drops a trailing slash so `/` under a mount is the mount itself', () => {
    const app = express();
    const r = Router();
    r.get('/', (_req, res) => res.json({}));
    app.use('/api/stats', r);

    expect(paths(app)).toEqual(['GET /api/stats']);
  });

  // ── auth gates (#494) ──────────────────────────────────────────────────────
  // The gate marks have to survive the same walk the paths do. The inherited
  // case is the subtle one: `router.use(gate)` applies to routes registered
  // AFTER it in that router, so gates accumulate down the tree rather than
  // being read off the route's own chain alone.

  const gatesFor = (app: Express, key: string) =>
    collectRoutes(app).find((r) => `${r.method} ${r.path}` === key)?.gates;

  it('reads a gate off the route own handler chain', () => {
    const app = express();
    app.get(
      '/x',
      markGate((_req, _res, next) => next(), 'auth'),
      (_req, res) => res.json({})
    );

    expect(gatesFor(app, 'GET /x')).toEqual(['auth']);
  });

  it('reports no gates for an unguarded route rather than guessing', () => {
    const app = express();
    app.get('/open', (_req, res) => res.json({}));

    expect(gatesFor(app, 'GET /open')).toEqual([]);
  });

  it('inherits a gate applied to the router with `use`', () => {
    const app = express();
    const r = Router();
    r.use(markGate((_req, _res, next) => next(), 'auth'));
    r.get('/inner', (_req, res) => res.json({}));
    app.use('/api', r);

    expect(gatesFor(app, 'GET /api/inner')).toEqual(['auth']);
  });

  it('accumulates an inherited gate with the route own', () => {
    const app = express();
    const r = Router();
    r.use(markGate((_req, _res, next) => next(), 'auth'));
    r.post(
      '/inner',
      markGate((_req, _res, next) => next(), 'permission'),
      (_req, res) => res.json({})
    );
    app.use('/api', r);

    expect(gatesFor(app, 'POST /api/inner')).toEqual(['auth', 'permission']);
  });

  // A gate registered AFTER a route does not protect it, and must not be
  // reported as if it did — that would be the dangerous direction, claiming
  // coverage the app does not have.
  it('does not apply a `use` gate to a route registered before it', () => {
    const app = express();
    const r = Router();
    r.get('/early', (_req, res) => res.json({}));
    r.use(markGate((_req, _res, next) => next(), 'auth'));
    r.get('/late', (_req, res) => res.json({}));
    app.use('/api', r);

    expect(gatesFor(app, 'GET /api/early')).toEqual([]);
    expect(gatesFor(app, 'GET /api/late')).toEqual(['auth']);
  });

  it('throws rather than reporting nothing when the internals move', () => {
    const notAnApp = {} as Express;

    expect(() => collectRoutes(notAnApp)).toThrow(/route table/i);
  });
});
