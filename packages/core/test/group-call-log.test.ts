import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey } from '../src';

// A group call used to save the group as a contact, so the group was listed twice in the chat list.
test('a group call log does not make the group a contact (no duplicate chat)', async () => {
  const c = new MessengerClient(new MemoryStorage());
  await c.init();
  const g = groupKey('0123456789abcdef');
  c.addCallLog(g, { video: false, outgoing: true, outcome: 'answered', durationSec: 11 } as never);
  c.addCallLog(g, { video: false, outgoing: true, outcome: 'answered', durationSec: 5 } as never);
  assert.deepEqual(c.contacts, []);
  assert.equal(c.chatKeys().filter((k) => k === g).length, 0); // listed only once the group itself is loaded
  c.addCallLog('asha', { video: false, outgoing: true, outcome: 'answered', durationSec: 3 } as never);
  assert.deepEqual(c.chatKeys(), ['asha']);
  c.dispose();
});
