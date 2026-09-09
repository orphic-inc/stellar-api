/**
 * #564 on /wiki — nine sites, six handlers, four of them transactions.
 *
 * The revision writes are the interesting half. `WikiRevision` is unique on
 * (pageId, revision), so a second editor who saves first takes the next revision
 * number and this one raises P2002 — a lost edit race reported as a 500, which
 * tells the caller nothing about reloading.
 *
 * A separate spec file: appending would push src/wiki.spec.ts toward Codacy's
 * 1000-line file limit.
 */
import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

const err = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const rankWith = (perms: Record<string, boolean>) => ({
  id: 1,
  name: 'User',
  level: 100,
  permissions: perms,
  color: null,
  badge: null,
  isDefault: true,
  isDonor: false,
  uploadMultiplier: 1,
  downloadDivider: 1
});

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  title: 'Test Page',
  slug: 'test-page',
  revision: 1,
  minReadLevel: 0,
  minEditLevel: 0,
  authorId: 7,
  body: '<p>Hello</p>',
  deletedAt: null,
  ...overrides
});

beforeEach(() => {
  resetApiTestState();
  prismaMock.userRank.findUnique.mockResolvedValue(
    rankWith({ wiki_manage: true, wiki_edit: true }) as never
  );
});

describe('wiki — a lost edit race answers 409, not 500 (#564)', () => {
  it('PUT /wiki/:id', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.$transaction.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .put('/api/wiki/2')
      .send({ title: 'Updated', body: '<p>Updated</p>' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'The page changed while you were editing, reload'
    });
  });

  it('POST /wiki/:id/rollback/:rev', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.wikiRevision.findUnique.mockResolvedValue({
      pageId: 2,
      revision: 1,
      title: 'Old',
      body: '<p>Old</p>'
    } as never);
    prismaMock.$transaction.mockRejectedValue(err('P2002'));

    const res = await request(app).post('/api/wiki/2/rollback/1');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'The page changed while you were rolling back, reload'
    });
  });

  it('POST /wiki on a slug taken since the check', async () => {
    prismaMock.wikiPage.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .post('/api/wiki')
      .send({ title: 'New Page', body: '<p>New</p>' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ msg: 'A page with this slug already exists' });
  });
});

describe('wiki — a page that vanishes answers 404, not 500 (#564)', () => {
  it('PUT /wiki/:id', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/wiki/2')
      .send({ title: 'Updated', body: '<p>Updated</p>' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Page not found' });
  });

  it('DELETE /wiki/:id', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/wiki/2');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Page not found' });
  });

  it('DELETE /wiki/:id/aliases/:alias', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.wikiAlias.findUnique.mockResolvedValue({
      alias: 'other',
      pageId: 2
    } as never);
    prismaMock.wikiAlias.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/wiki/2/aliases/other');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Alias not found on this page' });
  });
});

describe('wiki — POST /wiki/:id/aliases (#564)', () => {
  const prime = () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(page() as never);
    prismaMock.wikiAlias.findUnique.mockResolvedValue(null);
  };

  it('answers 404 when the page went away', async () => {
    prime();
    prismaMock.wikiAlias.create.mockRejectedValue(err('P2003'));

    const res = await request(app)
      .post('/api/wiki/2/aliases')
      .send({ alias: 'another-name' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Page not found' });
  });

  it('answers 409 when the alias was taken since the check', async () => {
    prime();
    prismaMock.wikiAlias.create.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .post('/api/wiki/2/aliases')
      .send({ alias: 'another-name' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ msg: 'Alias already in use' });
  });

  it('still propagates an error that is not a constraint violation', async () => {
    prime();
    prismaMock.wikiAlias.create.mockRejectedValue(new Error('connection lost'));

    const res = await request(app)
      .post('/api/wiki/2/aliases')
      .send({ alias: 'another-name' });

    expect(res.status).toBe(500);
  });
});
