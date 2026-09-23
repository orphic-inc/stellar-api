import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { makeCollage, makeCollageDetail } from './test/factories';

// #706: a personal collage is publicly readable; only its owner or staff may
// change it. The detail route alone refused to show one to another member,
// while the list, the profile's featured shelves, the comment thread and
// notifications already treated it as public. Split from collages.spec.ts to
// keep that file's size where it was.

beforeEach(() => resetApiTestState());

it("shows a member someone else's personal collage (#706)", async () => {
  prismaMock.collage.findUnique.mockResolvedValue(
    makeCollageDetail({
      categoryId: 0,
      userId: 99,
      entries: []
    }) as unknown as ReturnType<typeof makeCollage>
  );
  prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
  prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);

  const res = await request(app).get('/api/collages/1');

  expect(res.status).toBe(200);
  expect(res.body.categoryId).toBe(0);
  expect(res.body.userId).toBe(99);
});
