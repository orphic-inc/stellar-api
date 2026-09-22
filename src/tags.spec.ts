import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { Prisma } from '@prisma/client';

beforeEach(() => resetApiTestState());

const tag = { id: 4, name: 'shoegaze', occurrences: 0, isOfficial: true };

// ─── GET /api/tags/official ───────────────────────────────────────────────────

describe('GET /api/tags/official', () => {
  it('serves the curated vocabulary as a bare array, not a page', async () => {
    // The picker treats the vocabulary as one list. Wrapping it in { data, meta }
    // would make a truncated list indistinguishable from a complete one.
    prismaMock.tag.findMany.mockResolvedValue([tag] as never);

    const res = await request(app).get('/api/tags/official');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([tag]);
  });

  it('is reachable without tags_manage — it is a member surface', async () => {
    // The alias router gates even its GET. This one must not, or the picker
    // only works for staff.
    setCurrentUserPermissions({ tags_manage: false });
    prismaMock.tag.findMany.mockResolvedValue([] as never);

    const res = await request(app).get('/api/tags/official');

    expect(res.status).toBe(200);
  });

  it('is not shadowed by the parameterized demote route', async () => {
    prismaMock.tag.findMany.mockResolvedValue([tag] as never);

    const res = await request(app).get('/api/tags/official');

    expect(res.status).toBe(200);
    expect(prismaMock.tag.findMany).toHaveBeenCalled();
  });
});

// ─── GET /api/tags ────────────────────────────────────────────────────────────

describe('GET /api/tags', () => {
  it('pages the full table for a curator', async () => {
    setCurrentUserPermissions({ tags_manage: true });
    prismaMock.tag.findMany.mockResolvedValue([tag] as never);
    prismaMock.tag.count.mockResolvedValue(1 as never);

    const res = await request(app).get('/api/tags');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([tag]);
    expect(res.body.meta.total).toBe(1);
  });

  it('refuses a member without tags_manage', async () => {
    setCurrentUserPermissions({ tags_manage: false });

    const res = await request(app).get('/api/tags');

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/tags/official ──────────────────────────────────────────────────

describe('POST /api/tags/official', () => {
  beforeEach(() => {
    setCurrentUserPermissions({ tags_manage: true });
    prismaMock.tagAlias.findUnique.mockResolvedValue(null as never);
    prismaMock.tag.upsert.mockResolvedValue(tag as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('promotes and answers 201 with the resulting tag', async () => {
    const res = await request(app)
      .post('/api/tags/official')
      .send({ name: 'shoegaze' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(tag);
  });

  it('records BOTH the typed name and the one it landed on', async () => {
    // The audit row is the only record that normalization or an alias redirect
    // happened: the response alone cannot say what was asked for.
    await request(app).post('/api/tags/official').send({ name: 'ShoeGaze' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'tag.promote',
          targetType: 'Tag',
          metadata: { requested: 'ShoeGaze', resolved: 'shoegaze' }
        })
      })
    );
  });

  it('refuses a member without tags_manage', async () => {
    setCurrentUserPermissions({ tags_manage: false });

    const res = await request(app)
      .post('/api/tags/official')
      .send({ name: 'shoegaze' });

    expect(res.status).toBe(403);
    expect(prismaMock.tag.upsert).not.toHaveBeenCalled();
  });

  it('refuses a name with no usable characters (#689)', async () => {
    const res = await request(app)
      .post('/api/tags/official')
      .send({ name: '&&&' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'Tag name has no usable characters' });
    expect(prismaMock.tag.upsert).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const res = await request(app)
      .post('/api/tags/official')
      .send({ name: '' });

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/tags/:id/official ────────────────────────────────────────────

describe('DELETE /api/tags/:id/official', () => {
  beforeEach(() => {
    setCurrentUserPermissions({ tags_manage: true });
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('demotes and answers the resulting tag', async () => {
    prismaMock.tag.update.mockResolvedValue({
      ...tag,
      isOfficial: false
    } as never);

    const res = await request(app).delete('/api/tags/4/official');

    expect(res.status).toBe(200);
    expect(res.body.isOfficial).toBe(false);
  });

  it('audits the demotion', async () => {
    prismaMock.tag.update.mockResolvedValue({
      ...tag,
      isOfficial: false
    } as never);

    await request(app).delete('/api/tags/4/official');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'tag.demote' })
      })
    );
  });

  it('translates P2025 into a 404 rather than a 500 (#564)', async () => {
    prismaMock.tag.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2025',
        clientVersion: 'test'
      }) as never
    );

    const res = await request(app).delete('/api/tags/999/official');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Tag not found');
  });

  it('rejects a non-numeric id at the validator', async () => {
    const res = await request(app).delete('/api/tags/abc/official');

    expect(res.status).toBe(400);
  });

  it('refuses a member without tags_manage', async () => {
    setCurrentUserPermissions({ tags_manage: false });

    const res = await request(app).delete('/api/tags/4/official');

    expect(res.status).toBe(403);
    expect(prismaMock.tag.update).not.toHaveBeenCalled();
  });
});

// ─── The alias guard (ADR-0045) ───────────────────────────────────────────────
//
// `TagAlias.badTag` is a free String with no FK to `Tag`, so nothing in the
// schema stops an official tag being aliased away — leaving it marked canonical
// while the normalizer rewrites it at every write. These cover both write paths.

describe('official tags cannot be aliased away', () => {
  beforeEach(() => {
    setCurrentUserPermissions({ tags_manage: true });
  });

  it('refuses POST /api/tag-aliases when badTag is official', async () => {
    prismaMock.tag.findUnique.mockResolvedValue({ isOfficial: true } as never);

    const res = await request(app)
      .post('/api/tag-aliases')
      .send({ badTag: 'shoegaze', goodTag: 'dreampop' });

    expect(res.status).toBe(409);
    expect(res.body.msg).toContain('official tag');
    expect(prismaMock.tagAlias.create).not.toHaveBeenCalled();
  });

  it('refuses PUT /api/tag-aliases/:id renaming badTag onto an official tag', async () => {
    // The update path can walk an existing alias INTO the collision, so guarding
    // create alone would leave the same contradiction one edit away.
    prismaMock.tagAlias.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.tag.findUnique.mockResolvedValue({ isOfficial: true } as never);

    const res = await request(app)
      .put('/api/tag-aliases/1')
      .send({ badTag: 'shoegaze', goodTag: 'dreampop' });

    expect(res.status).toBe(409);
    expect(prismaMock.tagAlias.update).not.toHaveBeenCalled();
  });

  it('still allows aliasing an ordinary tag away', async () => {
    prismaMock.tag.findUnique
      .mockResolvedValueOnce({ isOfficial: false } as never)
      .mockResolvedValueOnce({ id: 9, name: 'dreampop' } as never);
    prismaMock.tagAlias.create.mockResolvedValue({ id: 2 } as never);

    const res = await request(app)
      .post('/api/tag-aliases')
      .send({ badTag: 'shoe.gaze', goodTag: 'dreampop' });

    expect(res.status).toBe(201);
    expect(prismaMock.tagAlias.create).toHaveBeenCalled();
  });
});

// ─── Alias names follow the tag name rule (#689, ADR-0047) ────────────────────
//
// The resolver looks `badTag` up NORMALIZED, so an alias stored any other way
// would never match. Both writes share one helper; POST covers the rule and PUT
// proves it is wired in.

describe('alias writes normalize both names', () => {
  beforeEach(() => {
    setCurrentUserPermissions({ tags_manage: true });
  });

  it('stores badTag normalized and finds goodTag by its normalized name', async () => {
    prismaMock.tag.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 9, name: 'dream.pop' } as never);
    prismaMock.tagAlias.create.mockResolvedValue({ id: 2 } as never);

    const res = await request(app)
      .post('/api/tag-aliases')
      .send({ badTag: 'Dreampop!', goodTag: 'Dream Pop' });

    expect(res.status).toBe(201);
    expect(prismaMock.tag.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { name: 'dream.pop' } })
    );
    expect(prismaMock.tagAlias.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ badTag: 'dreampop', goodTagId: 9 })
      })
    );
  });

  it('refuses a badTag with no usable characters', async () => {
    const res = await request(app)
      .post('/api/tag-aliases')
      .send({ badTag: '&&&', goodTag: 'dream.pop' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'Tag name has no usable characters' });
    expect(prismaMock.tagAlias.create).not.toHaveBeenCalled();
  });

  it('refuses an alias that normalizes onto its own target', async () => {
    // Normalization already does this alias's job, and the migration deletes
    // such rows, so the route must not be able to recreate one.
    prismaMock.tag.findUnique
      .mockResolvedValueOnce({ isOfficial: false } as never)
      .mockResolvedValueOnce({ id: 9, name: 'dream.pop' } as never);

    const res = await request(app)
      .post('/api/tag-aliases')
      .send({ badTag: 'Dream-Pop', goodTag: 'dream.pop' });

    expect(res.status).toBe(400);
    expect(res.body.msg).toContain('already');
    expect(prismaMock.tagAlias.create).not.toHaveBeenCalled();
  });

  it('normalizes on PUT as well', async () => {
    prismaMock.tagAlias.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.tag.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 9, name: 'dream.pop' } as never);
    prismaMock.tagAlias.update.mockResolvedValue({ id: 1 } as never);

    const res = await request(app)
      .put('/api/tag-aliases/1')
      .send({ badTag: 'Dreampop!', goodTag: 'Dream Pop' });

    expect(res.status).toBe(200);
    expect(prismaMock.tagAlias.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { badTag: 'dreampop', goodTagId: 9 }
      })
    );
  });
});
