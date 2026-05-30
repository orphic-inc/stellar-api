import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  sendMessage,
  replyToConversation,
  getUnreadCount
} from '../modules/pm';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `pm-${tag}-${Date.now()}`,
      email: `pm-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('sendMessage', () => {
  it('creates a conversation with sender in sentbox and recipient in inbox', async () => {
    const sender = await createUser('s1');
    const recipient = await createUser('r1');

    const result = await sendMessage(
      sender.id,
      recipient.id,
      'Hello there',
      'This is the body'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { conversation } = result;
    expect(conversation.subject).toBe('Hello there');
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].senderId).toBe(sender.id);

    const recipientParticipant = conversation.participants.find(
      (p) => p.userId === recipient.id
    );
    expect(recipientParticipant).toBeDefined();
    expect(recipientParticipant!.inInbox).toBe(true);
    expect(recipientParticipant!.isRead).toBe(false);

    const senderParticipant = conversation.participants.find(
      (p) => p.userId === sender.id
    );
    expect(senderParticipant).toBeDefined();
    expect(senderParticipant!.inSentbox).toBe(true);
    expect(senderParticipant!.isRead).toBe(true);
  });

  it('persists the conversation and message to the database', async () => {
    const sender = await createUser('s2');
    const recipient = await createUser('r2');

    const result = await sendMessage(
      sender.id,
      recipient.id,
      'Subject line',
      'Message body'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dbConv = await testPrisma.privateConversation.findUnique({
      where: { id: result.conversation.id },
      include: { messages: true, participants: true }
    });
    expect(dbConv).not.toBeNull();
    expect(dbConv!.messages).toHaveLength(1);
    expect(dbConv!.participants).toHaveLength(2);
  });

  it('prevents sending a message to yourself', async () => {
    const user = await createUser('self');

    const result = await sendMessage(user.id, user.id, 'To myself', 'body');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('self_message');
  });

  it('returns recipient_not_found for a non-existent user', async () => {
    const sender = await createUser('s3');

    const result = await sendMessage(sender.id, 999_999, 'subject', 'body');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('recipient_not_found');
  });

  it('returns recipient_disabled when recipient account is banned', async () => {
    const sender = await createUser('s4');
    const banned = await createUser('banned');
    await testPrisma.user.update({
      where: { id: banned.id },
      data: { disabled: true }
    });

    const result = await sendMessage(sender.id, banned.id, 'subject', 'body');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('recipient_disabled');
  });
});

describe('getUnreadCount', () => {
  it('returns 0 for a user with no messages', async () => {
    const user = await createUser('u1');
    const count = await getUnreadCount(user.id);
    expect(count).toBe(0);
  });

  it('increments when a new message is received', async () => {
    const sender = await createUser('s5');
    const recipient = await createUser('r5');

    const before = await getUnreadCount(recipient.id);
    expect(before).toBe(0);

    await sendMessage(sender.id, recipient.id, 'Hey', 'body');

    const after = await getUnreadCount(recipient.id);
    expect(after).toBe(1);
  });

  it('does not count sent conversations in the unread total', async () => {
    const sender = await createUser('s6');
    const recipient = await createUser('r6');

    await sendMessage(sender.id, recipient.id, 'Hey', 'body');

    const senderCount = await getUnreadCount(sender.id);
    expect(senderCount).toBe(0);
  });
});

describe('replyToConversation', () => {
  it('marks the recipient unread and the sender read after a reply', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');

    const initial = await sendMessage(alice.id, bob.id, 'First', 'body');
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const { id: convId } = initial.conversation;

    // Bob reads the message (mark as read by updating participant)
    await testPrisma.privateConversationParticipant.update({
      where: {
        userId_conversationId: { userId: bob.id, conversationId: convId }
      },
      data: { isRead: true }
    });

    // Bob replies
    const reply = await replyToConversation(convId, bob.id, 'Reply body');
    expect(reply.ok).toBe(true);

    // After Bob's reply, Alice should have isRead=false
    const aliceParticipant =
      await testPrisma.privateConversationParticipant.findUniqueOrThrow({
        where: {
          userId_conversationId: { userId: alice.id, conversationId: convId }
        }
      });
    expect(aliceParticipant.isRead).toBe(false);

    // Bob (sender of reply) should be read
    const bobParticipant =
      await testPrisma.privateConversationParticipant.findUniqueOrThrow({
        where: {
          userId_conversationId: { userId: bob.id, conversationId: convId }
        }
      });
    expect(bobParticipant.isRead).toBe(true);
  });

  it('returns not_participant when the sender is not in the conversation', async () => {
    const alice = await createUser('alice2');
    const bob = await createUser('bob2');
    const charlie = await createUser('charlie');

    const conv = await sendMessage(alice.id, bob.id, 'Hey', 'body');
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;

    const result = await replyToConversation(
      conv.conversation.id,
      charlie.id,
      'Intrude'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_participant');
  });
});
