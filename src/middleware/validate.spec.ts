import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate, validateParams, validateQuery } from './validate';

/**
 * A validator handle reads back what its own layer parsed, typed from the
 * schema (#234), and refuses to read for a route that never mounted it.
 */
const idParams = validateParams(
  z.object({ id: z.coerce.number().int().positive() })
);
const nameBody = validate(z.object({ name: z.string().min(1) }));
const pageQuery = validateQuery(
  z.object({ page: z.coerce.number().int().positive().default(1) })
);

// Handlers record what they read rather than echo it: a test server that
// reflects request input is a Semgrep finding even in a spec.
let seen: unknown;

const app = express();
app.use(express.json());
app.post('/items/:id', idParams, nameBody, (_req, res) => {
  const { id } = idParams.read(res);
  const { name } = nameBody.read(res);
  seen = { id, name, idType: typeof id };
  res.status(204).end();
});
app.get('/items/:id', idParams, pageQuery, (_req, res) => {
  seen = { ...idParams.read(res), ...pageQuery.read(res) };
  res.status(204).end();
});
// Reads a handle this route did not mount: the mistake the handle catches.
app.get('/unmounted', (_req, res) => {
  seen = nameBody.read(res);
  res.status(204).end();
});
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    seen = err.message;
    res.status(500).end();
  }
);

describe('validator handles (#234)', () => {
  it('read returns the parsed, coerced data', async () => {
    const res = await request(app).post('/items/7').send({ name: 'x' });
    expect(res.status).toBe(204);
    expect(seen).toEqual({ id: 7, name: 'x', idType: 'number' });
  });

  it('read applies schema defaults', async () => {
    await request(app).get('/items/3');
    expect(seen).toEqual({ id: 3, page: 1 });
  });

  it('one handle mounted on two routes reads per request', async () => {
    await request(app).get('/items/1?page=2');
    expect(seen).toEqual({ id: 1, page: 2 });
    await request(app).post('/items/2').send({ name: 'y' });
    expect(seen).toEqual({ id: 2, name: 'y', idType: 'number' });
  });

  it('still answers 400 before the handler runs', async () => {
    const res = await request(app).post('/items/0').send({ name: '' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors)).toEqual(['id']);
  });

  it('read throws for a route that did not mount the handle', async () => {
    const res = await request(app).get('/unmounted');
    expect(res.status).toBe(500);
    expect(seen).toMatch(/body validator this route did not mount/);
  });

  it('types read from the schema', () => {
    type Read = ReturnType<typeof idParams.read>;
    const ok: Read = { id: 1 };
    // @ts-expect-error a field the schema does not have
    const wrong: Read = { id: 1, slug: 'x' };
    // @ts-expect-error the schema's type, not a hand-picked one
    const mistyped: Read = { id: '1' };
    expect([ok, wrong, mistyped]).toHaveLength(3);
  });
});
