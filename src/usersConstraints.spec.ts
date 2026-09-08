/**
 * #564 on /users — ten sites, every one of them a read-then-write.
 *
 * That shape is why this surface appears in no tally on the issue: each handler
 * does a `findUnique` and 404s, which the pre-correction rule read as "guarded".
 * A read answers the ordinary case and leaves the window open, and the write is
 * what meets P2025.
 */
import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

const err = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const perms = (p: Record<string, boolean>) =>
  prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank(p));

const someUser = () => ({ id: 5, username: 'target', disabled: false });

beforeEach(() => resetApiTestState());

describe('users — a row that vanishes between the read and the write (#564)', () => {
  it('POST /users/:id/disable answers 404, not 500', async () => {
    perms({ users_disable: true });
    prismaMock.user.findUnique.mockResolvedValue(someUser() as never);
    prismaMock.user.update.mockRejectedValue(err('P2025'));

    const res = await request(app).post('/api/users/5/disable');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });

  it('POST /users/:id/enable answers 404, not 500', async () => {
    perms({ users_disable: true });
    prismaMock.user.findUnique.mockResolvedValue(someUser() as never);
    prismaMock.user.update.mockRejectedValue(err('P2025'));

    const res = await request(app).post('/api/users/5/enable');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });

  it('PUT /users/:id/rank-lock answers 404, not 500', async () => {
    perms({ users_manage: true, rank_permissions_manage: true, admin: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.user.update.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/users/5/rank-lock')
      .send({ rankLocked: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });

  it('DELETE /users/:id/donor answers 404, not 500', async () => {
    perms({ donor_manage: true, admin: true });
    prismaMock.user.findUnique.mockResolvedValue(someUser() as never);
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/users/5/donor');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });

  it('DELETE /users/:id/notes/:noteId answers 404, not 500', async () => {
    perms({ users_moderate: true, admin: true });
    prismaMock.userModerationNote.findFirst.mockResolvedValue({
      id: 9,
      userId: 5
    } as never);
    prismaMock.userModerationNote.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/users/5/notes/9');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Note not found' });
  });

  it('DELETE /users/donor-ranks/:rankId answers 404, not 500', async () => {
    perms({ donor_ranks_manage: true, admin: true });
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.donorRank.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/users/donor-ranks/3');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Donor rank not found' });
  });
});

describe('users — POST /users/:id/notes (#564)', () => {
  it('answers 404 when the path user id names nothing', async () => {
    // `authorId` is session-derived, so only the PATH id can dangle.
    perms({ users_moderate: true, admin: true });
    prismaMock.user.findUnique.mockResolvedValue(someUser() as never);
    prismaMock.userModerationNote.create.mockRejectedValue(err('P2003'));

    const res = await request(app)
      .post('/api/users/5/notes')
      .send({ body: 'a note' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'User not found' });
  });
});

describe('users — donor rank names are unique (#564)', () => {
  // DonorRank.name carries a unique constraint and the model has no foreign
  // key, so P2002 is the one reachable code on create.
  it('POST /users/donor-ranks answers 409 on a duplicate name', async () => {
    perms({ donor_ranks_manage: true, admin: true });
    prismaMock.donorRank.create.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .post('/api/users/donor-ranks')
      .send({ name: 'Gold', minDonation: 10 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'A donor rank with that name already exists'
    });
  });

  it('PUT /users/donor-ranks/:rankId answers 409 on a duplicate name', async () => {
    perms({ donor_ranks_manage: true, admin: true });
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.donorRank.update.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .put('/api/users/donor-ranks/3')
      .send({ name: 'Gold', minDonation: 10 });

    expect(res.status).toBe(409);
  });

  it('PUT /users/donor-ranks/:rankId answers 404 when it vanished', async () => {
    perms({ donor_ranks_manage: true, admin: true });
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.donorRank.update.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/users/donor-ranks/3')
      .send({ name: 'Gold', minDonation: 10 });

    expect(res.status).toBe(404);
  });
});

describe('users — recovery requests (#564)', () => {
  it('DELETE /users/recovery-requests/:reqId answers 404, not 500', async () => {
    perms({ users_manage: true, admin: true });
    prismaMock.accountRecovery.findUnique.mockResolvedValue({
      id: 4,
      usedAt: null
    } as never);
    prismaMock.accountRecovery.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/users/recovery-requests/4');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Recovery request not found' });
  });

  it('still propagates an error that is not a constraint violation', async () => {
    perms({ users_disable: true });
    prismaMock.user.findUnique.mockResolvedValue(someUser() as never);
    prismaMock.user.update.mockRejectedValue(new Error('connection lost'));

    const res = await request(app).post('/api/users/5/disable');

    expect(res.status).toBe(500);
  });
});
