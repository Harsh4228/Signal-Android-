import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, Flag, MessageSquareWarning, UserX } from 'lucide-react-native';
import { REPORT_REASONS, DELETE_REQUEST, type Report } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Button, Header, Row, Sheet, errorText, useBack, type SheetAction } from '../ui';

type Toast = (m: string) => void;
const link = { color: colors.accent, fontWeight: '600' as const, fontSize: 14 };

/** Block or unblock, after asking. Blocked people can't message or call me. */
export function confirmBlock(user: string, onToast: Toast) {
  const name = client.displayName(user);
  if (client.isBlocked(user)) {
    void client.setBlocked(user, false).then(() => onToast(`${name} unblocked`), (e) => onToast(errorText(e)));
    return;
  }
  Alert.alert(`Block ${name}?`, `${name} won't be able to message or call you. They are not told.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Block',
      style: 'destructive',
      onPress: () => void client.setBlocked(user, true).then(() => onToast(`${name} blocked`), (e) => onToast(errorText(e))),
    },
  ]);
}

/**
 * Report someone to the admins: choose a reason, then send it with the last messages of this chat (so the admins
 * can see what happened; they can't read encrypted chats otherwise), optionally blocking them too.
 */
export function ReportSheet({ user, chat, onClose, onToast }: { user: string; chat?: string; onClose: () => void; onToast: Toast }) {
  const name = client.displayName(user);
  const send = (reason: string, block: boolean) =>
    void client
      .report(user, reason, { chat: chat ?? user, includeMessages: true })
      .then(() => (block && !client.isBlocked(user) ? client.setBlocked(user, true) : undefined))
      .then(() => onToast(block ? `Reported and blocked ${name}` : `Reported ${name}. Your admin will look at it.`), (e) => onToast(errorText(e)));
  const actions: SheetAction[] = REPORT_REASONS.map((reason) => ({
    icon: Flag,
    label: reason,
    onPress: () =>
      Alert.alert(`Report ${name}?`, 'Your admin gets the last messages of this chat to look at. They are not told who reported them.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Report', onPress: () => send(reason, false) },
        ...(client.isBlocked(user) ? [] : [{ text: 'Report and block', style: 'destructive' as const, onPress: () => send(reason, true) }]),
      ]),
  }));
  return <Sheet title={`Why are you reporting ${name}?`} actions={actions} onClose={onClose} />;
}

/** Settings > Blocked: everyone I blocked, to unblock. */
export function BlockedScreen({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const c = useClient();
  useBack(onClose);
  return (
    <View style={[s.fill, { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg }]}>
      <Header title="Blocked" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={[s.muted, { marginBottom: 12, lineHeight: 19 }]}>
          Blocked people can't message or call you. To block someone, open their chat, tap their name and choose Block.
        </Text>
        <View style={[s.card, { paddingVertical: 4 }]}>
          {!c.blocked.length && <Text style={[s.muted, { padding: 14 }]}>Nobody is blocked.</Text>}
          {c.blocked.map((u, i) => (
            <View key={u}>
              {i > 0 && <View style={[s.divider, { marginLeft: 64 }]} />}
              <View style={[s.row, { gap: 12, padding: 12 }]}>
                <Avatar name={u} size={40} />
                <Text style={[s.textStrong, { flex: 1 }]}>{c.displayName(u)}</Text>
                <Button title="Unblock" variant="secondary" onPress={() => confirmBlock(u, onToast)} />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Settings, when only an admin may delete accounts: ask the admins to delete mine. */
export function requestDeletion(onToast: Toast) {
  Alert.alert(
    'Delete my account',
    'Your company manages your account, so your admin deletes it. Send them a request? Your account, messages and files are then removed from the server.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send request',
        style: 'destructive',
        onPress: () => void client.requestAccountDeletion().then(() => onToast('Request sent to your admin'), (e) => onToast(errorText(e))),
      },
    ],
  );
}

const when = (ts: number) => new Date(ts).toLocaleString();

/** Admin: reports from people about others, and account deletion requests. */
export function ReportsTab({ onToast }: { onToast: Toast }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<Report | null>(null);
  const [note, setNote] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const load = () => void client.getReports().then(setReports, (e) => onToast(errorText(e)));
  useEffect(load, []);

  if (open) {
    const deletion = open.reason === DELETE_REQUEST;
    return (
      <View style={{ gap: 12 }}>
        <Pressable onPress={() => setOpen(null)}>
          <Text style={[link, { marginBottom: 4 }]}>‹ All reports</Text>
        </Pressable>
        <View style={[s.card, { padding: 16, gap: 6 }]}>
          <Text style={s.textStrong}>{deletion ? `${client.displayName(open.user)} asks to delete their account` : `${client.displayName(open.by)} reported ${client.displayName(open.user)}`}</Text>
          <Text style={s.muted}>
            {open.reason} · {when(open.ts)}
          </Text>
          {!!open.details && <Text style={s.text}>{open.details}</Text>}
          {deletion && <Text style={[s.muted, { lineHeight: 19 }]}>Delete the account under People (open the person, Remove), then close this request.</Text>}
          {!deletion && <Text style={[s.muted, { lineHeight: 19 }]}>Act on it within 24 hours: talk to them, remove them from groups, or remove the account under People.</Text>}
        </View>
        {!!open.messages.length && (
          <>
            <Text style={s.section}>Messages they sent along</Text>
            <View style={[s.card, { padding: 12, gap: 10 }]}>
              {open.messages.map((m, i) => (
                <View key={i}>
                  <Text style={[s.muted, { fontSize: 12 }]}>
                    {client.displayName(m.from)} · {when(m.ts)}
                  </Text>
                  <Text style={[s.text, m.from === open.user && { color: colors.danger }]}>{m.text}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        {open.status === 'open' ? (
          <View style={{ gap: 8 }}>
            <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="What you did (optional)" placeholderTextColor={colors.faint} />
            <Button
              icon={Check}
              title={deletion ? 'Done, close request' : 'Close report'}
              onPress={() =>
                void client.closeReport(open.id, note).then(
                  () => {
                    setOpen(null);
                    setNote('');
                    load();
                    onToast('Closed');
                  },
                  (e) => onToast(errorText(e)),
                )
              }
            />
          </View>
        ) : (
          <Text style={s.muted}>
            Closed by {open.closedBy} · {open.closedAt ? when(open.closedAt) : ''}
            {open.note ? `\n${open.note}` : ''}
          </Text>
        )}
      </View>
    );
  }

  const list = (reports ?? []).filter((r) => showClosed || r.status === 'open');
  return (
    <View style={{ gap: 12 }}>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        People report messages or behaviour here, or ask for their account to be deleted. App stores expect reports to be handled within 24 hours.
      </Text>
      <View style={[s.card, { paddingVertical: 4 }]}>
        {reports === null && <Text style={[s.muted, { padding: 14 }]}>Loading…</Text>}
        {reports !== null && !list.length && <Text style={[s.muted, { padding: 14 }]}>No open reports.</Text>}
        {list.map((r, i) => (
          <View key={r.id}>
            {i > 0 && <View style={[s.divider, { marginLeft: 52 }]} />}
            <Row
              icon={r.reason === DELETE_REQUEST ? UserX : r.status === 'open' ? MessageSquareWarning : Ban}
              danger={r.status === 'open'}
              title={r.reason === DELETE_REQUEST ? `${client.displayName(r.user)}: delete account` : `${client.displayName(r.user)}: ${r.reason}`}
              subtitle={`${r.reason === DELETE_REQUEST ? '' : `by ${client.displayName(r.by)} · `}${when(r.ts)}${r.status === 'closed' ? ' · closed' : ''}`}
              onPress={() => setOpen(r)}
            />
          </View>
        ))}
      </View>
      <Pressable onPress={() => setShowClosed(!showClosed)}>
        <Text style={link}>{showClosed ? 'Hide closed reports' : 'Show closed reports'}</Text>
      </Pressable>
    </View>
  );
}
