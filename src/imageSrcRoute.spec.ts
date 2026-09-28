/**
 * The `*Src` hook runs on every JSON response (#737 slice 3): proven here on
 * one real route, since the resolver's own spec calls it directly.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { makeAuthorRefRow, makeCommentWithAuthor } from './test/factories';

jest.mock('./modules/comment', () => ({
  deleteComment: jest.fn(),
  canSeeCommentThread: async () => true,
  canSeeThreadOf: async () => true
}));

const REMOTE = 'https://images.example/avatar.png';
const HASH = 'c'.repeat(64);

beforeEach(() => resetApiTestState());

it("adds an author's resolved avatar beside the raw one", async () => {
  prismaMock.comment.findMany.mockResolvedValue([
    makeCommentWithAuthor({
      id: 12,
      author: makeAuthorRefRow({ avatar: REMOTE })
    })
  ] as never);
  prismaMock.comment.count.mockResolvedValue(1);
  prismaMock.remoteImage.findMany.mockResolvedValue([
    { url: REMOTE, assetHash: HASH }
  ] as never);

  const res = await request(app).get('/api/comments?context=artist&pageId=3');

  expect(res.status).toBe(200);
  expect(res.body.data[0].author).toMatchObject({
    avatar: REMOTE,
    avatarSrc: `/api/asset/${HASH}`
  });
});
