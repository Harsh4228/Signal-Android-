import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_RE, suggestUserId } from '../src';

test('new user ID: made from the name, unique in the company, always valid', () => {
  assert.equal(suggestUserId('Ravi Kumar', []), 'ravi kumar');
  assert.equal(suggestUserId('  Ravi   Kumar ', ['ravi kumar']), 'ravi kumar 2');
  assert.equal(suggestUserId('Ravi Kumar', ['Ravi Kumar', 'ravi kumar 2']), 'ravi kumar 3');
  assert.equal(suggestUserId('A.B. Shah-Patel / HR', []), 'a.b. shah patel hr');
  assert.equal(suggestUserId('Al', []), 'al1');
  assert.equal(suggestUserId('   ', []), '');
  assert.equal(suggestUserId('---', []), '');
  const long = suggestUserId('Venkata Subramanian Lakshminarayanan Iyer', []);
  assert.ok(ID_RE.test(long) && long.length <= 32, long);
  assert.ok(ID_RE.test(suggestUserId('Ravi', Array.from({ length: 50 }, (_, i) => (i ? `ravi ${i + 1}` : 'ravi')))));
});
