import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, Clock, LifeBuoy, Mail, MessageSquare, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react-native';
import { MAX_EMAIL, MAX_HELP_FIELD, MAX_PHONE, shortId, type AdminUser, type HelpContact, type HelpContactInput } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Banner, Button, Field, Header, IconButton, errorText, useBack } from '../ui';

type Toast = (m: string) => void;
type Draft = HelpContactInput & { id?: string };
const EMPTY: Draft = { title: '', name: '', department: '', phone: '', email: '', hours: '', username: '' };

/** One contact card with call / email / chat buttons. */
function ContactCard({ c, onChat }: { c: HelpContact; onChat?: (u: string) => void }) {
  return (
    <View style={[s.card, { padding: 14, gap: 10 }]}>
      <View style={[s.row, { gap: 12 }]}>
        {c.username ? (
          <Avatar name={c.username} size={44} />
        ) : (
          <View style={styles.icon}>
            <LifeBuoy size={22} color={colors.accent} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.textStrong}>{c.title}</Text>
          {!!(c.name || c.department) && (
            <Text style={s.muted}>{[c.name, c.department && `for ${c.department}`].filter(Boolean).join(' · ')}</Text>
          )}
        </View>
      </View>
      {!!c.hours && (
        <View style={[s.row, { gap: 6 }]}>
          <Clock size={14} color={colors.muted} />
          <Text style={s.muted}>{c.hours}</Text>
        </View>
      )}
      <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
        {!!c.phone && <Button title={c.phone} icon={Phone} onPress={() => void Linking.openURL(`tel:${c.phone.replace(/[^+\d]/g, '')}`)} />}
        {!!c.email && <Button title="Email" icon={Mail} onPress={() => void Linking.openURL(`mailto:${c.email}`)} />}
        {!!c.username && onChat && c.username !== client.account?.username && (
          <Button title="Chat" icon={MessageSquare} onPress={() => onChat(c.username)} />
        )}
      </View>
    </View>
  );
}

/** Everyone: whom to contact for help (IT, HR, accounts, …), as the company admin set it up. */
export function HelpDeskScreen({ onClose, onChat }: { onClose: () => void; onChat: (username: string) => void }) {
  useBack(onClose);
  const [contacts, setContacts] = useState<HelpContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.getHelpDesk().then(setContacts, (e) => setError(errorText(e)));
  }, []);
  const q = query.trim().toLowerCase();
  const shown = (contacts ?? []).filter((c) => `${c.title} ${c.name} ${c.department} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  return (
    <View style={s.fill}>
      <Header title="Help desk" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} keyboardShouldPersistTaps="handled">
        {error && <Banner kind="error">{error}</Banner>}
        {(contacts?.length ?? 0) > 5 && (
          <View style={styles.search}>
            <Search size={17} color={colors.faint} />
            <Field value={query} onChangeText={setQuery} placeholder="Search: IT, HR, a name…" style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0 }} />
          </View>
        )}
        {contacts === null && !error && <Text style={s.muted}>Loading…</Text>}
        {contacts?.length === 0 && (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <LifeBuoy size={40} color={colors.faint} />
            <Text style={[s.muted, { textAlign: 'center' }]}>Your admin hasn't added any help contacts yet.</Text>
          </View>
        )}
        {shown.map((c) => (
          <ContactCard key={c.id} c={c} onChat={onChat} />
        ))}
      </ScrollView>
    </View>
  );
}

/** Company admin: keep the help desk list (whom to call for what). */
export function HelpDeskTab({ users, departments, onToast }: { users: AdminUser[] | null; departments: string[]; onToast: Toast }) {
  const [contacts, setContacts] = useState<HelpContact[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    client.getHelpDesk().then(setContacts, (e) => onToast(errorText(e)));
  }, [onToast]);
  useEffect(load, [load]);

  async function save(list: Draft[], message: string) {
    setBusy(true);
    try {
      setContacts(await client.setHelpDesk(list));
      setEditing(null);
      onToast(message);
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const list = [...(contacts ?? [])];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void save(list, 'Order saved');
  };

  if (editing) {
    return (
      <ContactEditor
        draft={editing}
        users={users ?? []}
        departments={departments}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={(d) => {
          const list: Draft[] = contacts ?? [];
          const next = d.id ? list.map((c) => (c.id === d.id ? d : c)) : [...list, d];
          void save(next, `Saved "${d.title}"`);
        }}
      />
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
      <Banner kind="ok" icon={LifeBuoy}>
        Contacts everyone can open from the help icon: IT, HR, accounts, a manager per department… with mobile, email and
        hours.
      </Banner>
      {contacts === null && <Text style={s.muted}>Loading…</Text>}
      {contacts?.map((c, i) => (
        <View key={c.id} style={[s.card, s.row, { padding: 12, gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.textStrong}>{c.title}</Text>
            <Text style={s.muted} numberOfLines={1}>
              {[c.name, c.department, c.phone, c.email].filter(Boolean).join(' · ') || 'No details yet'}
            </Text>
          </View>
          <IconButton icon={ArrowUp} label="Move up" onPress={() => move(i, -1)} />
          <IconButton icon={ArrowDown} label="Move down" onPress={() => move(i, 1)} />
          <IconButton icon={Pencil} label="Edit" onPress={() => setEditing(c)} />
          <IconButton
            icon={Trash2}
            label="Remove"
            color={colors.danger}
            onPress={() => void save((contacts ?? []).filter((x) => x.id !== c.id), `Removed "${c.title}"`)}
          />
        </View>
      ))}
      <Button variant="primary" title="Add contact" icon={Plus} onPress={() => setEditing({ ...EMPTY })} />
    </ScrollView>
  );
}

function ContactEditor({
  draft,
  users,
  departments,
  busy,
  onCancel,
  onSave,
}: {
  draft: Draft;
  users: AdminUser[];
  departments: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (d: Draft) => void;
}) {
  useBack(onCancel);
  const [d, setD] = useState<Draft>(draft);
  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));
  /** Fill name, mobile and email from a colleague's profile. */
  const pick = (u: AdminUser) =>
    setD((x) => ({ ...x, username: u.username, name: x.name || u.name, phone: x.phone || u.phone, email: x.email || u.email }));
  const [who, setWho] = useState('');
  const matches = who.trim()
    ? users.filter((u) => `${u.name} ${shortId(u.username)}`.toLowerCase().includes(who.trim().toLowerCase())).slice(0, 6)
    : [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{draft.id ? 'Edit contact' : 'New contact'}</Text>
      <Field label="Title" value={d.title} onChangeText={set('title')} placeholder="e.g. IT support, HR, Accounts" maxLength={MAX_HELP_FIELD} />
      <Field label="Name or team" value={d.name} onChangeText={set('name')} placeholder="e.g. Sunil Mehta" maxLength={MAX_HELP_FIELD} />
      <Text style={s.label}>For department</Text>
      <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
        {['', ...departments].map((dep) => (
          <Pressable key={dep || 'all'} onPress={() => set('department')(dep)} style={[styles.chip, d.department === dep && styles.chipOn]}>
            <Text style={{ color: d.department === dep ? colors.accentText : colors.text2, fontSize: 13 }}>{dep || 'Everyone'}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Mobile" value={d.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={MAX_PHONE} />
      <Field label="Email" value={d.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" maxLength={MAX_EMAIL} />
      <Field label="Hours" value={d.hours} onChangeText={set('hours')} placeholder="e.g. Mon-Fri 9:00-18:00" maxLength={MAX_HELP_FIELD} />
      <Field label="Chat in CellMate (optional)" value={who} onChangeText={setWho} placeholder={d.username ? client.displayName(d.username) : 'Find a colleague'} />
      {matches.map((u) => (
        <Pressable key={u.username} onPress={() => (pick(u), setWho(''))} style={[styles.chip, { alignSelf: 'flex-start' }]}>
          <Text style={s.text}>{u.name || shortId(u.username)}</Text>
        </Pressable>
      ))}
      {!!d.username && (
        <View style={[s.row, { gap: 8 }]}>
          <Text style={[s.muted, { flex: 1 }]}>Chat button opens a chat with {client.displayName(d.username)}.</Text>
          <Button title="Remove" onPress={() => set('username')('')} />
        </View>
      )}
      <View style={[s.row, { gap: 10 }]}>
        <Button title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button variant="primary" title="Save" busy={busy} disabled={!d.title.trim()} onPress={() => onSave(d)} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: '#b9cbf7' },
});
