import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortHelpContacts } from '../src';

const list = [
  { title: 'IT support', name: 'Ravi', department: 'Sales' },
  { title: 'Accounts', name: '', department: 'Finance' },
  { title: 'HR', name: 'Asha', department: '' },
];

test('help desk: sorted by topic, person or department; or as the admin put them', () => {
  assert.deepEqual(sortHelpContacts(list, 'title').map((c) => c.title), ['Accounts', 'HR', 'IT support']);
  assert.deepEqual(sortHelpContacts(list, 'name').map((c) => c.title), ['HR', 'IT support', 'Accounts']); // no person last
  assert.deepEqual(sortHelpContacts(list, 'department').map((c) => c.title), ['Accounts', 'IT support', 'HR']); // none last
  assert.deepEqual(sortHelpContacts(list, 'admin').map((c) => c.title), ['IT support', 'Accounts', 'HR']);
});
