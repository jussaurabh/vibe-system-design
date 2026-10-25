import { newMessageId, newSessionId } from './id.js';

describe('id factory', () => {
  it('prefixes a session id with ses_ and a message id with msg_', () => {
    expect(newSessionId()).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newMessageId()).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('never repeats an id inside one process', () => {
    const ids = Array.from({ length: 1000 }, () => newMessageId());
    expect(new Set(ids).size).toBe(1000);
  });

  it('sorts ids in the order they were created', () => {
    const ids = Array.from({ length: 100 }, () => newSessionId());
    expect([...ids].sort()).toEqual(ids);
  });
});
