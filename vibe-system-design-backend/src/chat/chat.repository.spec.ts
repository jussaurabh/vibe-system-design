import { eq } from 'drizzle-orm';

import { createDb } from '../db/db.client.js';
import { chatMessages, chatSessions } from '../db/schema.js';
import { DrizzleChatRepository } from './chat.repository.js';
import { newMessageId, newSessionId } from './utils/id.js';

const USER_ID = 'test-repository-user';

describe.skipIf(!process.env.DATABASE_URL)('DrizzleChatRepository', () => {
  let db: ReturnType<typeof createDb>['db'];
  let repository: DrizzleChatRepository;
  const createdSessionIds: string[] = [];

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!).db;
    repository = new DrizzleChatRepository(db);
  });

  afterAll(async () => {
    for (const id of createdSessionIds) {
      await db.delete(chatSessions).where(eq(chatSessions.id, id));
    }
  });

  it('an empty session sorts by its creation time', async () => {
    const used = newSessionId();
    const empty = newSessionId();
    createdSessionIds.push(used, empty);

    await repository.createSession(USER_ID, used, 1000);
    await repository.createSession(USER_ID, empty, 3000);
    await repository.appendMessage({
      id: newMessageId(),
      sessionId: used,
      senderType: 'user',
      content: [{ type: 'text', text: 'hi' }],
      status: 'complete',
      tokenCount: null,
      modelName: null,
      latencyMs: null,
      createdAt: 2000,
    });

    const sessions = await repository.listSessions(USER_ID);
    const ids = sessions.map((s) => s.id);
    expect(ids.indexOf(empty)).toBeLessThan(ids.indexOf(used));
  });

  it('a deleted message leaves a gap and the next append does not reuse the seq', async () => {
    const sessionId = newSessionId();
    createdSessionIds.push(sessionId);
    await repository.createSession(USER_ID, sessionId, 1000);

    const first = await repository.appendMessage({
      id: newMessageId(), sessionId, senderType: 'user',
      content: [{ type: 'text', text: 'one' }], status: 'complete',
      tokenCount: null, modelName: null, latencyMs: null, createdAt: 1001,
    });
    const second = await repository.appendMessage({
      id: newMessageId(), sessionId, senderType: 'user',
      content: [{ type: 'text', text: 'two' }], status: 'complete',
      tokenCount: null, modelName: null, latencyMs: null, createdAt: 1002,
    });
    const third = await repository.appendMessage({
      id: newMessageId(), sessionId, senderType: 'user',
      content: [{ type: 'text', text: 'three' }], status: 'complete',
      tokenCount: null, modelName: null, latencyMs: null, createdAt: 1003,
    });
    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);

    await db.delete(chatMessages).where(eq(chatMessages.id, second.id));

    const fourth = await repository.appendMessage({
      id: newMessageId(), sessionId, senderType: 'user',
      content: [{ type: 'text', text: 'four' }], status: 'complete',
      tokenCount: null, modelName: null, latencyMs: null, createdAt: 1004,
    });
    expect(fourth.seq).toBe(4);
  });

  it('deleting a session cascades to its messages', async () => {
    const sessionId = newSessionId();
    createdSessionIds.push(sessionId);
    await repository.createSession(USER_ID, sessionId, 1000);
    await repository.appendMessage({
      id: newMessageId(), sessionId, senderType: 'user',
      content: [{ type: 'text', text: 'one' }], status: 'complete',
      tokenCount: null, modelName: null, latencyMs: null, createdAt: 1001,
    });

    expect(await repository.deleteSession(USER_ID, sessionId)).toBe(true);
    expect(await repository.listMessages(sessionId)).toEqual([]);
  });

  it('lists the messages of a session in seq order', async () => {
    const sessionId = newSessionId();
    createdSessionIds.push(sessionId);
    await repository.createSession(USER_ID, sessionId, 1000);
    for (const text of ['one', 'two', 'three']) {
      await repository.appendMessage({
        id: newMessageId(), sessionId, senderType: 'user',
        content: [{ type: 'text', text }], status: 'complete',
        tokenCount: null, modelName: null, latencyMs: null, createdAt: 1001,
      });
    }

    const messages = await repository.listMessages(sessionId);
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(messages.map((m) => m.content[0])).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'text', text: 'three' },
    ]);
  });
});
