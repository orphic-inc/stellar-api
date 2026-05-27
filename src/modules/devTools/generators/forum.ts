/**
 * devTools/generators/forum.ts
 *
 * Integrated-mode only. Attaches generated topics and posts to EXISTING
 * forum boards. Forum counter mutations (numTopics, numPosts, lastTopicId)
 * are tracked via DevSeedMutation so cleanup can revert them.
 *
 * Coverage:
 *   Models: ForumTopic, ForumPost, ForumPostEdit, ForumPoll, ForumPollVote,
 *           ForumTopicNote, ForumLastReadTopic
 *   Edge cases: locked topic, sticky topic, topic with poll,
 *               moderator topic note, post with edit history
 */

import { PrismaClient } from '@prisma/client';
import { RunContext } from '../types';
import {
  pick,
  pickN,
  randInt,
  randBool,
  daysAgo,
  SeedContext
} from '../seedRandom';
import { makeBBCodeForumPost } from '../contentFactory';
import { trackCreate, trackMutation } from '../tracking';

// ─── Content helpers ─────────────────────────────────────────────────────────

const TOPIC_TITLE_PREFIXES = [
  'Question about',
  'Discussion:',
  'Help with',
  'Thoughts on',
  'Feedback needed:',
  'Announcement:',
  'Looking for',
  'Anyone know about',
  'Share your',
  'New release from'
];

const TOPIC_TITLE_SUBJECTS = [
  'lossless encoding practices',
  'site feature request',
  'album recommendation thread',
  'contribution guidelines',
  'ratio requirements',
  'staff introduction',
  'weekly listening thread',
  'genre deep dive',
  'equipment recommendations',
  'upcoming releases',
  'archive policy',
  'tagging conventions',
  'collage nominations',
  'request thread revival'
];

const POLL_QUESTIONS = [
  'What format do you prefer for archival uploads?',
  'How do you primarily listen to music?',
  'Which genre do you want more of?',
  'How long have you been a member?',
  'Do you participate in community collages?',
  'What should we focus on next?',
  "Rate the site's current contribution guidelines"
];

const POLL_OPTION_SETS = [
  ['FLAC', 'MP3 V0', 'MP3 320', 'AAC', 'Other'],
  ['Streaming', 'Local files', 'CD/Vinyl', 'Mixed'],
  ['Electronic', 'Rock', 'Jazz', 'Classical', 'Hip-hop', 'Folk'],
  ['Less than 1 year', '1–3 years', '3–5 years', '5+ years'],
  ['Yes, regularly', 'Sometimes', 'Rarely', 'Never'],
  ['Better search', 'More forums', 'Improved UI', 'More curators'],
  ['Excellent', 'Good', 'Needs improvement', 'Poor']
];

function makeTopicTitle(rng: SeedContext): string {
  const prefix = pick(TOPIC_TITLE_PREFIXES, rng);
  const subject = pick(TOPIC_TITLE_SUBJECTS, rng);
  return `${prefix} ${subject}`;
}

function makePollAnswers(rng: SeedContext): string {
  const optionSet = pick(POLL_OPTION_SETS, rng);
  return JSON.stringify(optionSet);
}

// ─── Generator ────────────────────────────────────────────────────────────────

export async function generateForum(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;

  if (config.mode === 'isolated') {
    ctx.warnings.push(
      'Forum generator requires integrated mode — skipped in isolated mode'
    );
    return;
  }

  if (ctx.generatedUserIds.length === 0) {
    ctx.warnings.push('Forum generator: no generated users — skipping');
    return;
  }

  const rng = new SeedContext(config.seed).fork('forum');
  const users = ctx.generatedUserIds;
  const staffUsers =
    ctx.generatedStaffUserIds.length > 0 ? ctx.generatedStaffUserIds : users;

  // Attach to existing real forums — do NOT create new ones
  const forums = await prisma.forum.findMany({
    where: { isTrash: false },
    select: { id: true, numTopics: true, numPosts: true, lastTopicId: true },
    orderBy: { sort: 'asc' }
  });

  if (forums.length === 0) {
    ctx.warnings.push('Forum generator: no existing forums found — skipping');
    return;
  }

  const topicsPerForum = Math.max(
    1,
    Math.round((config.counts.forumTopics * config.scale) / forums.length)
  );

  const createdTopicIds: number[] = [];
  const createdPostIds: number[] = [];

  for (const forum of forums) {
    // Snapshot before-state for mutation tracking / cleanup revert
    const before = {
      numTopics: forum.numTopics,
      numPosts: forum.numPosts,
      lastTopicId: forum.lastTopicId
    };

    const topicCount = randInt(
      Math.max(1, topicsPerForum - 1),
      topicsPerForum + 2,
      rng
    );
    let addedTopics = 0;
    let addedPosts = 0;
    let lastNewTopicId: number | null = null;

    for (let t = 0; t < topicCount; t++) {
      const authorId = pick(users, rng);
      const isLocked = config.includeEdgeCases && t === 0;
      const isSticky = config.includeEdgeCases && t === 1;
      const topicCreatedAt = daysAgo(0, 365, rng);

      const topic = await prisma.forumTopic.create({
        data: {
          forumId: forum.id,
          title: makeTopicTitle(rng),
          authorId,
          isLocked,
          isSticky,
          numPosts: 0, // reconciled below
          createdAt: topicCreatedAt,
          updatedAt: topicCreatedAt
        }
      });

      createdTopicIds.push(topic.id);
      addedTopics++;
      lastNewTopicId = topic.id;

      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'ForumTopic',
        { id: topic.id }
      );

      // Posts for this topic (at least 1, up to ~12)
      const postCount = randBool(0.7, rng)
        ? randInt(1, 8, rng)
        : randInt(9, 12, rng);

      let lastPostId: number | null = null;

      for (let p = 0; p < postCount; p++) {
        const postAuthorId = p === 0 ? authorId : pick(users, rng);
        const postCreatedAt = new Date(
          topicCreatedAt.getTime() +
            p * 3_600_000 +
            randInt(0, 1800, rng) * 1000
        );

        const post = await prisma.forumPost.create({
          data: {
            forumTopicId: topic.id,
            authorId: postAuthorId,
            body: makeBBCodeForumPost(rng),
            createdAt: postCreatedAt,
            updatedAt: postCreatedAt
          }
        });

        lastPostId = post.id;
        createdPostIds.push(post.id);
        addedPosts++;

        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ForumPost',
          { id: post.id }
        );

        // Post edit history (~15% of posts)
        if (randBool(0.15, rng)) {
          const editedAt = new Date(postCreatedAt.getTime() + 1_800_000);
          const edit = await prisma.forumPostEdit.create({
            data: {
              forumPostId: post.id,
              editorId: postAuthorId,
              previousBody: post.body,
              editedAt
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'ForumPostEdit',
            { id: edit.id }
          );
        }
      }

      // Update topic numPosts + lastPostId
      await prisma.forumTopic.update({
        where: { id: topic.id },
        data: { numPosts: postCount, lastPostId }
      });

      // Poll (~20% of topics)
      if (randBool(0.2, rng)) {
        const question = pick(POLL_QUESTIONS, rng);
        const answers = makePollAnswers(rng);
        const poll = await prisma.forumPoll.create({
          data: {
            forumTopicId: topic.id,
            question,
            answers,
            closed: config.includeEdgeCases && randBool(0.2, rng),
            featured: randBool(0.1, rng) ? new Date() : null
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ForumPoll',
          { id: poll.id }
        );

        // Poll votes from some users
        const parsed = JSON.parse(answers) as string[];
        const voterCount = randInt(0, Math.min(5, users.length), rng);
        const voters = pickN(users, voterCount, rng);
        for (const voterId of voters) {
          try {
            const vote = await prisma.forumPollVote.create({
              data: {
                forumPollId: poll.id,
                userId: voterId,
                vote: randInt(0, parsed.length - 1, rng)
              }
            });
            await trackCreate(
              prisma as Parameters<typeof trackCreate>[0],
              runId,
              'ForumPollVote',
              { id: vote.id }
            );
          } catch {
            // Duplicate vote — skip
          }
        }
      }

      // Moderator topic note (~10% of topics, staff users only)
      if (
        config.includeModerationData &&
        randBool(0.1, rng) &&
        staffUsers.length > 0
      ) {
        const staffId = pick(staffUsers, rng);
        const note = await prisma.forumTopicNote.create({
          data: {
            forumTopicId: topic.id,
            authorId: staffId,
            body: 'Seed mod note — generated for testing.'
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ForumTopicNote',
          { id: note.id }
        );
      }

      // ForumLastReadTopic for a subset of generated users
      if (lastPostId !== null) {
        const readCount = Math.min(randInt(0, 5, rng), users.length);
        const readers = pickN(users, readCount, rng);
        for (const readerId of readers) {
          try {
            await prisma.forumLastReadTopic.create({
              data: {
                userId: readerId,
                forumTopicId: topic.id,
                forumPostId: lastPostId
              }
            });
          } catch {
            // Duplicate — skip
          }
        }
      }
    }

    // After creating all topics for this forum, track the mutation and update counters
    const after = {
      numTopics: forum.numTopics + addedTopics,
      numPosts: forum.numPosts + addedPosts,
      lastTopicId: lastNewTopicId ?? forum.lastTopicId
    };

    await trackMutation(
      prisma as Parameters<typeof trackMutation>[0],
      runId,
      'Forum',
      { id: forum.id },
      before,
      after,
      'counter_increment',
      true // reversible
    );

    await prisma.forum.update({
      where: { id: forum.id },
      data: {
        numTopics: { increment: addedTopics },
        numPosts: { increment: addedPosts },
        ...(lastNewTopicId ? { lastTopicId: lastNewTopicId } : {})
      }
    });
  }

  ctx.generatedForumTopicIds = createdTopicIds;
  ctx.summary['ForumTopic'] = createdTopicIds.length;
  ctx.summary['ForumPost'] = createdPostIds.length;
}
