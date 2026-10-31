import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { shortId, sortUsers, type UserProfile } from '@meetme/core';
import { client } from '../messenger';
import { SortSelect, errorText } from './ui';
import { AvatarTap } from './Profile';

const NO_DEPT = 'No department';

/** Colleagues grouped by department (someone in two departments shows in both), filtered by name / ID / department. */
function byDepartment(users: UserProfile[], q: string, flat: boolean): [string, UserProfile[]][] {
  const match = (u: UserProfile) =>
    !q || (u.name || '').toLowerCase().includes(q) || shortId(u.username).includes(q) || u.departments.some((d) => d.toLowerCase().includes(q));
  const found = sortUsers(users.filter(match), 'name');
  if (flat) return found.length ? [['Everyone', found]] : [];
  const groups = new Map<string, UserProfile[]>();
  for (const u of found) {
    for (const d of u.departments.length ? u.departments : [NO_DEPT]) {
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d)!.push(u);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)));
}

/**
 * Everyone in the company you can message, by department, like WhatsApp's "New chat" list.
 * With onBack it is a full sidebar pane with its own header; without, it fills the empty chat list (first login).
 */
export function Directory({ onOpen, onBack, onToast }: { onOpen: (username: string) => void; onBack?: () => void; onToast: (m: string) => void }) {
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.listDirectory().then(setUsers, (e) => setError(errorText(e)));
  }, []);
  const q = query.trim().toLowerCase();
  const [sort, setSort] = useState<'department' | 'name'>('department');
  const groups = useMemo(() => byDepartment(users ?? [], q, sort === 'name'), [users, q, sort]);

  return (
    <>
      {onBack && (
        <div className="pane-head">
          <button className="icon" title="Back" onClick={onBack}>
            <ArrowLeft size={19} />
          </button>
          <span className="grow">New chat</span>
        </div>
      )}
      <div className="add">
        <Search size={16} className="add-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onBack && (e.preventDefault(), onBack())}
          placeholder="Search name, ID or department"
          autoFocus={!!onBack}
        />
      </div>
      <div className="row dir-sort">
        <SortSelect
          value={sort}
          options={[
            ['department', 'By department'],
            ['name', 'Name A–Z'],
          ]}
          onChange={setSort}
        />
      </div>
      <ul className="contacts">
        {error && <li className="none">{error}</li>}
        {!onBack && users && users.length > 0 && <li className="dir-hint">Your colleagues: click someone to start a chat.</li>}
        {users && groups.length === 0 && <li className="none">{q ? 'Nobody matches' : 'No colleagues have joined yet'}</li>}
        {groups.map(([dept, people]) => [
          <li key={`h:${dept}`} className="dir-head">
            {dept} · {people.length}
          </li>,
          ...people.map((u) => (
            <li key={`${dept}:${u.username}`} onClick={() => onOpen(u.username)}>
              <AvatarTap user={u.username} onToast={onToast} />
              <div className="grow">
                <div className="name">{u.name || shortId(u.username)}</div>
                <div className="preview">{[shortId(u.username), ...u.departments].join(' · ')}</div>
              </div>
            </li>
          )),
        ])}
      </ul>
    </>
  );
}
