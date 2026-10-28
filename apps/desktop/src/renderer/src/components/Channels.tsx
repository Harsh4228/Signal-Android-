import { useCallback, useEffect, useState } from 'react';
import { Check, Megaphone, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { MAX_GROUP_NAME, groupKey, type ChannelInfo, type Community, type GroupInfo } from '@meetme/core';
import { client, useClient } from '../messenger';
import { errorText } from './ui';

/** Channels anyone in the company can follow (only their admins post), and communities (groups put together). */
export function ChannelsPanel({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [channels, setChannels] = useState<ChannelInfo[] | null>(null);
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const load = useCallback(() => {
    Promise.all([client.listChannels(), client.listCommunities()]).then(
      ([ch, co]) => (setChannels(ch), setCommunities(co)),
      (e) => onToast(errorText(e)),
    );
  }, [onToast]);
  useEffect(load, [load]);
  const open = (id: string) => (client.setActiveChat(groupKey(id)), onClose());
  const follow = (ch: ChannelInfo) =>
    void client.followChannel(ch.id, !ch.following).then(
      () => (onToast(ch.following ? `Left ${ch.name}` : `Following ${ch.name}`), load()),
      (e) => onToast(errorText(e)),
    );
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Megaphone size={18} />
            </span>
            Channels & communities
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body">
          <div className="section-title" style={{ marginTop: 0 }}>
            Channels
          </div>
          {channels === null && <p className="muted">Loading…</p>}
          {channels?.length === 0 && <p className="muted small">No channels yet. Your admin can create them.</p>}
          <ul className="emp-list">
            {channels?.map((ch) => (
              <li key={ch.id} className={ch.following ? 'clickable' : ''} onClick={() => ch.following && open(ch.id)}>
                <span className="title-icon">
                  <Megaphone size={16} />
                </span>
                <div className="grow">
                  <div className="name">{ch.name}</div>
                  <div className="state">
                    {ch.followers} follower{ch.followers === 1 ? '' : 's'}
                  </div>
                </div>
                <button className={ch.following ? '' : 'primary'} onClick={(e) => (e.stopPropagation(), follow(ch))}>
                  {ch.following ? 'Following' : 'Follow'}
                </button>
              </li>
            ))}
          </ul>
          <div className="section-title">Communities</div>
          {communities?.length === 0 && <p className="muted small">No communities yet. Your admin can put groups together into one.</p>}
          {communities?.map((co) => (
            <div key={co.id} className="help-card" style={{ marginBottom: 10 }}>
              <div className="name">{co.name}</div>
              {co.description && <div className="muted small">{co.description}</div>}
              <ul className="member-list">
                {co.groups.map((id) => {
                  const g = c.groupOf(groupKey(id));
                  const channel = channels?.find((x) => x.id === id);
                  return (
                    <li key={id} className={g ? 'clickable' : ''} onClick={() => g && open(id)}>
                      {channel ? <Megaphone size={15} /> : <UsersRound size={15} />}
                      <span className={g ? '' : 'muted'}>{g?.name ?? channel?.name ?? 'A group you are not in'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Draft = Omit<Community, 'id'> & { id?: string };

/** Company admin: communities (groups and channels put together, e.g. per office or project). */
export function CommunitiesTab({ groups, onToast }: { groups: GroupInfo[] | null; onToast: (m: string) => void }) {
  const [list, setList] = useState<Community[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  useEffect(() => {
    client.listCommunities().then(setList, (e) => onToast(errorText(e)));
  }, [onToast]);
  const save = (next: Draft[], msg: string) =>
    void client.setCommunities(next).then(
      (l) => (setList(l), setEditing(null), onToast(msg)),
      (e) => onToast(errorText(e)),
    );
  const nameOf = (id: string) => groups?.find((g) => g.id === id)?.name ?? 'Deleted group';
  if (editing) {
    const d = editing;
    const toggle = (id: string) => setEditing({ ...d, groups: d.groups.includes(id) ? d.groups.filter((g) => g !== id) : [...d.groups, id] });
    return (
      <div className="form-grid">
        <h3 style={{ margin: '4px 0' }}>{d.id ? 'Edit community' : 'New community'}</h3>
        <label>
          Name
          <input value={d.name} onChange={(e) => setEditing({ ...d, name: e.target.value })} placeholder="e.g. Pune office" maxLength={MAX_GROUP_NAME} autoFocus />
        </label>
        <label>
          Description
          <input value={d.description} onChange={(e) => setEditing({ ...d, description: e.target.value })} placeholder="What it is for" maxLength={300} />
        </label>
        <div className="section-title" style={{ margin: 0 }}>
          Groups and channels in it
        </div>
        <div className="chips" style={{ margin: 0 }}>
          {(groups ?? []).map((g) => (
            <button key={g.id} type="button" className={d.groups.includes(g.id) ? 'active' : ''} onClick={() => toggle(g.id)}>
              {d.groups.includes(g.id) && <Check size={13} />} {g.name}
              {g.kind === 'channel' ? ' (channel)' : ''}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button className="primary" disabled={!d.name.trim()} onClick={() => save(d.id ? (list ?? []).map((c) => (c.id === d.id ? d : c)) : [...(list ?? []), d], `Saved "${d.name}"`)}>
            Save
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="muted small" style={{ marginTop: 4 }}>
        <UsersRound size={14} /> Put groups and channels together, e.g. one community per office or project. Everyone sees them under
        Channels & communities.
      </p>
      {list === null && <p className="muted">Loading…</p>}
      <ul className="emp-list">
        {list?.map((c) => (
          <li key={c.id}>
            <div className="grow">
              <div className="name">{c.name}</div>
              <div className="state">{c.groups.map(nameOf).join(', ') || 'No groups yet'}</div>
            </div>
            <button className="icon" title="Edit" onClick={() => setEditing(c)}>
              <Pencil size={15} />
            </button>
            <button className="icon danger-text" title="Delete" onClick={() => save((list ?? []).filter((x) => x.id !== c.id), `Deleted "${c.name}"`)}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={() => setEditing({ name: '', description: '', groups: [] })}>
        <Plus size={16} /> New community
      </button>
    </>
  );
}