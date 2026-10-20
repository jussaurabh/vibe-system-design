import { monotonicFactory } from 'ulid';

// One factory for both id types, so every id of one process forms one
// increasing sequence.
const ulid = monotonicFactory();

export function newSessionId(): string {
  return `ses_${ulid()}`;
}

export function newMessageId(): string {
  return `msg_${ulid()}`;
}
