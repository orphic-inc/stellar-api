import {
  app,
  request,
  prismaMock,
  makeUserRank,
  resetApiTestState
} from './test/apiTestHarness';
import * as reportsModule from './modules/reports';
import type {
  ReportRow,
  ReportSummary,
  ReportNoteRow
} from './modules/reports';

jest.mock('./modules/reports', () => ({
  fileReport: jest.fn(),
  listReports: jest.fn(),
  getReport: jest.fn(),
  claimReport: jest.fn(),
  unclaimReport: jest.fn(),
  resolveReport: jest.fn(),
  addNote: jest.fn(),
  listMyReports: jest.fn(),
  getReportCounts: jest.fn()
}));

const reportsMock = reportsModule as jest.Mocked<typeof reportsModule>;

const makeReportSummary = (): ReportSummary => ({
  id: 1,
  targetType: 'ForumPost',
  targetId: 42,
  category: 'spam',
  status: 'Open',
  createdAt: new Date(),
  resolvedAt: null,
  resolution: null
});

const makeNote = (): ReportNoteRow => ({
  id: 1,
  reportId: 1,
  authorId: 7,
  author: { id: 7, username: 'alice', avatar: null },
  body: 'Investigated, confirmed spam',
  createdAt: new Date()
});

const makeReport = (): ReportRow => ({
  id: 1,
  reporterId: 7,
  reporter: { id: 7, username: 'alice', avatar: null },
  targetType: 'ForumPost',
  targetId: 42,
  category: 'spam',
  reason: 'This is spam',
  evidence: null,
  status: 'Open',
  claimedById: null,
  claimedBy: null,
  claimedAt: null,
  resolvedById: null,
  resolvedBy: null,
  resolvedAt: null,
  resolution: null,
  resolutionAction: null,
  notes: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true })
  );

beforeEach(() => resetApiTestState());

describe('GET /api/reports/counts', () => {
  it('returns counts for staff', async () => {
    setStaff();
    reportsMock.getReportCounts.mockResolvedValue({ open: 3, claimed: 1 });
    const res = await request(app).get('/api/reports/counts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ open: 3, claimed: 1 });
  });

  it('rejects non-staff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).get('/api/reports/counts');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/reports/mine', () => {
  it('returns the current user reports', async () => {
    reportsMock.listMyReports.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 25,
      reports: [makeReportSummary()]
    });
    const res = await request(app).get('/api/reports/mine');
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
  });
});

describe('GET /api/reports', () => {
  it('returns paginated queue for staff', async () => {
    setStaff();
    reportsMock.listReports.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 25,
      reports: [makeReport()]
    });
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
  });

  it('rejects non-staff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/reports', () => {
  it('files a report', async () => {
    reportsMock.fileReport.mockResolvedValue({
      ok: true,
      report: makeReport()
    });
    const res = await request(app).post('/api/reports').send({
      targetType: 'ForumPost',
      targetId: 42,
      category: 'spam',
      reason: 'This is spam'
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/reports').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reports/:id', () => {
  it('returns report to the filer', async () => {
    reportsMock.getReport.mockResolvedValue({
      ok: true,
      report: makeReport()
    });
    const res = await request(app).get('/api/reports/1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    reportsMock.getReport.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    const res = await request(app).get('/api/reports/999');
    expect(res.status).toBe(404);
  });

  it('returns 403 when forbidden', async () => {
    reportsMock.getReport.mockResolvedValue({
      ok: false,
      reason: 'forbidden'
    });
    const res = await request(app).get('/api/reports/1');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/reports/:id/claim', () => {
  it('claims a report for staff', async () => {
    setStaff();
    reportsMock.claimReport.mockResolvedValue({ ok: true });
    const res = await request(app).post('/api/reports/1/claim');
    expect(res.status).toBe(204);
  });

  it('returns 409 when already claimed', async () => {
    setStaff();
    reportsMock.claimReport.mockResolvedValue({
      ok: false,
      reason: 'already_claimed'
    });
    const res = await request(app).post('/api/reports/1/claim');
    expect(res.status).toBe(409);
  });
});

describe('POST /api/reports/:id/unclaim', () => {
  it('unclaims a report', async () => {
    setStaff();
    reportsMock.unclaimReport.mockResolvedValue({ ok: true });
    const res = await request(app).post('/api/reports/1/unclaim');
    expect(res.status).toBe(204);
  });

  it('returns 422 when not claimed', async () => {
    setStaff();
    reportsMock.unclaimReport.mockResolvedValue({
      ok: false,
      reason: 'not_claimed'
    });
    const res = await request(app).post('/api/reports/1/unclaim');
    expect(res.status).toBe(422);
  });
});

describe('POST /api/reports/:id/resolve', () => {
  it('resolves a report', async () => {
    setStaff();
    reportsMock.resolveReport.mockResolvedValue({ ok: true });
    const res = await request(app).post('/api/reports/1/resolve').send({
      resolution: 'Post removed',
      resolutionAction: 'ContentRemoved'
    });
    expect(res.status).toBe(204);
  });

  it('returns 422 when already resolved', async () => {
    setStaff();
    reportsMock.resolveReport.mockResolvedValue({
      ok: false,
      reason: 'already_resolved'
    });
    const res = await request(app).post('/api/reports/1/resolve').send({
      resolution: 'Post removed',
      resolutionAction: 'ContentRemoved'
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/reports/:id/notes', () => {
  it('adds a note for staff', async () => {
    setStaff();
    reportsMock.addNote.mockResolvedValue({ ok: true, note: makeNote() });
    const res = await request(app)
      .post('/api/reports/1/notes')
      .send({ body: 'Investigated, confirmed spam' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  it('rejects non-staff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .post('/api/reports/1/notes')
      .send({ body: 'note' });
    expect(res.status).toBe(403);
  });
});
