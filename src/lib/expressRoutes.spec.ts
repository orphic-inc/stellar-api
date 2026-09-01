import express, { Router, type Express } from 'express';

import { collectRoutes } from './expressRoutes';

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

  it('throws rather than reporting nothing when the internals move', () => {
    const notAnApp = {} as Express;

    expect(() => collectRoutes(notAnApp)).toThrow(/route table/i);
  });
});
