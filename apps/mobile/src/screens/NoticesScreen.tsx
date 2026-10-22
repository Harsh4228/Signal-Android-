import { useEffect, useState } from 'react';
import { BackHandler, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Bell, BellRing, Check, CheckCheck, Plus, Send } from 'lucide-react-native';
import {
  MAX_NOTICE_TITLE,
  departmentsOf,
  noticeAudience,
  type AdminUser,
  type GroupInfo,
  type Notice,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, Header, IconButton, clock, errorText } from '../ui';
import { Chip } from './BroadcastScreen';
import type { Route } from '../App';

function when(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${clock(ts)}`;
}

/**
 * Unread notices, one at a time over the whole app as soon as it opens (or a notice arrives).
 * The only way out is OK (the back button does nothing), which also tells the admin it was read.
 * Drawn inside the app window, not a RN <Modal>, so screenshots stay blocked.
 */
export function NoticePopup() {
  const c = useClient();
  const pending = c.pendingNotices();
  const [busy, setBusy] = useState(false);
  const n = pending[0];

  useEffect(() => {
    if (!n) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [n]);

  if (!n) return null;

  async function ok() {
    setBusy(true);
    try {
      await client.acknowledgeNotice(n!.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.dim]} accessibilityViewIsModal>
      <View style={styles.pop}>
        <View style={[s.row, { gap: 10, marginBottom: 12 }]}>
          <View style={styles.icon}>
            <BellRing size={18} color={colors.accent} />
          </View>
          <Text style={s.textStrong}>
            Notice
            {pending.length > 1 && <Text style={s.muted}> · 1 of {pending.length}</Text>}
          </Text>
        </View>
        {!!n.title && <Text style={[s.title, { fontSize: 19, marginBottom: 10 }]}>{n.title}</Text>}
        {!!n.text && (
          <ScrollView style={styles.body} contentContainerStyle={{ padding: 12 }}>
            <Text style={[s.text, { color: colors.text2, lineHeight: 22 }]}>{n.text}</Text>
          </ScrollView>
        )}
        <Text style={[s.muted, { marginTop: 12, marginBottom: 16 }]}>
          From {n.from} · {when(n.ts)}
        </Text>
        <Button variant="primary" icon={Check} title="OK" busy={busy} onPress={ok} />
      </View>
    </View>
  );
}

/** Every notice I received (and, for admins, sent), newest first. */
export function NoticesScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const [open, setOpen] = useState<string | null>(null);
  const list = c.getNotices();

  return (
    <View style={s.fill}>
      <Header
        title="Notices"
        onBack={() => navigate({ name: 'list' })}
        right={
          c.isAdmin && (
            <IconButton
              icon={Plus}
              label="New notice"
              disabled={c.status !== 'online'}
              onPress={() => navigate({ name: 'notice-new' })}
            />
          )
        }
      />
      <FlatList
        data={list}
        keyExtractor={(n) => `${n.from}:${n.id}`}
        contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={[s.center, { gap: 6 }]}>
            <Bell size={30} color={colors.faint} />
            <Text style={s.muted}>No notices yet</Text>
            {c.isAdmin && (
              <Text style={[s.muted, { fontSize: 12, textAlign: 'center' }]}>
                Tap + to send one. It pops up on employees' screens until they tap OK.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <NoticeItem n={item} open={open === item.id} onToggle={() => setOpen(open === item.id ? null : item.id)} />
        )}
      />
    </View>
  );
}

function NoticeItem({ n, open, onToggle }: { n: Notice; open: boolean; onToggle: () => void }) {
  const recipients = n.recipients ?? [];
  const readers = recipients.filter((u) => n.okBy?.[u]);
  const waiting = recipients.filter((u) => !n.okBy?.[u]);
  return (
    <View style={[s.card, { padding: 14, gap: 8 }]}>
      <View style={[s.row, { gap: 8, alignItems: 'flex-start' }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.textStrong}>{n.title || 'Notice'}</Text>
          <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]}>
            {n.outgoing ? `You → ${n.audience ?? 'Everyone'}` : `From ${n.from}`} · {when(n.ts)}
          </Text>
        </View>
        {n.outgoing ? null : n.okAt ? (
          <Tag label="Read" fg="#067647" bg={colors.okSoft} />
        ) : (
          <Tag label="New" fg={colors.accentText} bg={colors.accentSoft} />
        )}
      </View>
      {!!n.text && <Text style={[s.text, { color: colors.text2, fontSize: 14, lineHeight: 20 }]}>{n.text}</Text>}
      {n.outgoing && (
        <Pressable onPress={onToggle} style={[s.row, styles.readCount]} accessibilityRole="button">
          <CheckCheck size={14} color={colors.accentText} />
          <Text style={{ color: colors.accentText, fontSize: 13, fontWeight: '500' }}>
            Read by {readers.length} of {recipients.length}
          </Text>
        </Pressable>
      )}
      {n.outgoing && open && (
        <View style={{ gap: 4 }}>
          <Text style={[s.section, { marginTop: 6, marginBottom: 2 }]}>Read ({readers.length})</Text>
          {readers.length ? (
            readers.map((u) => (
              <Text key={u} style={[s.text, { fontSize: 14 }]}>
                {u} <Text style={s.muted}>· {when(n.okBy![u]!)}</Text>
              </Text>
            ))
          ) : (
            <Text style={s.muted}>Nobody yet</Text>
          )}
          <Text style={[s.section, { marginTop: 10, marginBottom: 2 }]}>Not yet ({waiting.length})</Text>
          <Text style={waiting.length ? [s.text, { fontSize: 14 }] : s.muted}>
            {waiting.length ? waiting.join(', ') : 'Everyone has read it'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Tag({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** Admin: write a notice and pick who gets it (everyone, or any departments and groups). */
export function NewNoticeScreen({ navigate, onDone }: { navigate: (r: Route) => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.listAllUsers().then(setUsers).catch(() => setUsers(null));
    client.listAllGroups().then(setGroups).catch(() => setGroups([]));
    client.listDepartments().then(setDepartmentList).catch(() => setDepartmentList([]));
  }, []);

  const me = client.account?.username;
  const target = { departments: depts, groups: groupIds };
  const recipients = noticeAudience(users ?? [], groups, target, me);
  const everyone = noticeAudience(users ?? [], groups, {}, me);
  const departments = [...new Set([...departmentList, ...departmentsOf(users ?? [])])].sort((a, b) => a.localeCompare(b));
  const picked = depts.length + groupIds.length;
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shownNames = recipients.slice(0, 6);

  async function send() {
    setBusy(true);
    try {
      const r = await client.sendNotice(title, text, target);
      onDone(r.failed.length ? `Notice sent to ${r.sent}. Failed: ${r.failed.join(', ')}` : `Notice sent to ${r.sent} employees`);
      navigate({ name: 'notices' });
    } catch (e) {
      onDone(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.fill}>
      <Header title="New notice" onBack={() => navigate({ name: 'notices' })} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, s.row, { padding: 14, gap: 12, alignItems: 'flex-start' }]}>
          <View style={styles.icon}>
            <BellRing size={18} color={colors.accent} />
          </View>
          <Text style={[s.muted, { flex: 1, lineHeight: 19 }]}>
            {users === null ? 'Loading employees…' : `Goes to ${recipients.length} employees.`} It pops up on their screen
            until they tap OK, and you can see who has read it.
          </Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Send to</Text>
          <View style={styles.chips}>
            <Chip
              label={`Everyone (${everyone.length})`}
              active={!picked}
              onPress={() => {
                setDepts([]);
                setGroupIds([]);
              }}
            />
          </View>
          {departments.length > 0 && (
            <>
              <Text style={[s.muted, { fontSize: 12 }]}>Departments</Text>
              <View style={styles.chips}>
                {departments.map((d) => {
                  const count = noticeAudience(users ?? [], [], { departments: [d] }, me).length;
                  return (
                    <Chip
                      key={d}
                      label={`${d} (${count})`}
                      active={depts.includes(d)}
                      disabled={!count && !depts.includes(d)}
                      onPress={() => toggle(depts, setDepts, d)}
                    />
                  );
                })}
              </View>
            </>
          )}
          {groups.length > 0 && (
            <>
              <Text style={[s.muted, { fontSize: 12 }]}>Groups</Text>
              <View style={styles.chips}>
                {groups.map((g) => {
                  const count = noticeAudience(users ?? [], [g], { groups: [g.id] }, me).length;
                  return (
                    <Chip
                      key={g.id}
                      label={`${g.name} (${count})`}
                      active={groupIds.includes(g.id)}
                      disabled={!count && !groupIds.includes(g.id)}
                      onPress={() => toggle(groupIds, setGroupIds, g.id)}
                    />
                  );
                })}
              </View>
            </>
          )}
          {recipients.length > 0 && (
            <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={2}>
              To: {shownNames.join(', ')}
              {recipients.length > shownNames.length ? ` and ${recipients.length - shownNames.length} more` : ''}
            </Text>
          )}
        </View>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={setTitle}
          maxLength={MAX_NOTICE_TITLE}
          placeholder="Title, e.g. Office closed on Friday"
          placeholderTextColor={colors.faint}
          autoFocus
        />
        <TextInput
          style={[s.input, { minHeight: 160, textAlignVertical: 'top', lineHeight: 21 }]}
          value={text}
          onChangeText={setText}
          placeholder="Write the notice…"
          placeholderTextColor={colors.faint}
          multiline
        />
        <Button
          variant="primary"
          icon={Send}
          title="Send notice"
          busy={busy}
          disabled={(!title.trim() && !text.trim()) || !recipients.length}
          onPress={send}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(16,24,40,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  pop: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  body: {
    flexGrow: 0,
    maxHeight: 360,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readCount: {
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#b9cbf7',
    backgroundColor: colors.accentSoft,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
