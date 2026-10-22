import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, FileText, Image, Megaphone, Paperclip, Send, X } from 'lucide-react-native';
import { departmentsOf, formatBytes, type AdminUser, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { pickFile, type PickKind } from '../files';
import { colors, s } from '../theme';
import { Button, Header, IconButton, Sheet, errorText } from '../ui';
import type { Route } from '../App';

export function BroadcastScreen({ navigate, onDone }: { navigate: (r: Route) => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  /** Empty = everyone. */
  const [only, setOnly] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<OutgoingFile | null>(null);
  const [choosing, setChoosing] = useState(false);

  async function load(kind: PickKind) {
    try {
      const f = await pickFile(kind);
      if (f) setFile(f);
    } catch (e) {
      onDone(errorText(e));
    }
  }

  const [departmentList, setDepartmentList] = useState<string[]>([]);

  useEffect(() => {
    client
      .listAllUsers()
      .then(setUsers)
      .catch(() => setUsers(null));
    client
      .listDepartments()
      .then(setDepartmentList)
      .catch(() => setDepartmentList([]));
  }, []);

  // Same rule as client.listActiveRecipients: logged in at least once, not banned, not me.
  const reachable = (users ?? []).filter((u) => u.active && !u.banned && u.username !== client.account?.username);
  // Every department the admin made (plus any still on a user), even empty ones, so the choice is always there.
  const departments = [...new Set([...departmentList, ...departmentsOf(reachable)])].sort((a, b) => a.localeCompare(b));
  const inDept = (d: string) => reachable.filter((u) => u.departments.includes(d)).length;
  // Someone in several of the chosen departments still counts (and gets the message) once.
  const recipients = only.length ? reachable.filter((u) => u.departments.some((d) => only.includes(d))) : reachable;
  const count = users === null ? null : recipients.length;
  const shownNames = recipients.slice(0, 6).map((u) => u.username);
  const toggle = (d: string) => setOnly((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  const where = only.length ? ` in ${only.join(', ')}` : '';

  async function send() {
    setBusy(true);
    try {
      const r = await client.broadcast(text, file ?? undefined, { departments: only });
      onDone(r.failed.length ? `Sent to ${r.sent}. Failed: ${r.failed.join(', ')}` : `Announcement sent to ${r.sent} employees${where}`);
      navigate({ name: 'list' });
    } catch (e) {
      onDone(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = (!text.trim() && !file) || !count;

  return (
    <View style={s.fill}>
      <Header title="New announcement" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, s.row, { padding: 14, gap: 12, alignItems: 'flex-start' }]}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Megaphone size={18} color={colors.accent} />
          </View>
          <Text style={[s.muted, { flex: 1, lineHeight: 19 }]}>
            {count === null ? 'Loading employees…' : `Goes to ${count} employees${where}.`} Each copy is end-to-end
            encrypted separately. Replies come back to you as private chats.
          </Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Send to</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip label={`Everyone (${reachable.length})`} active={!only.length} onPress={() => setOnly([])} />
            {departments.map((d) => (
              <Chip
                key={d}
                label={`${d} (${inDept(d)})`}
                active={only.includes(d)}
                disabled={!inDept(d) && !only.includes(d)}
                onPress={() => toggle(d)}
              />
            ))}
          </View>
          {!departments.length && (
            <Text style={[s.muted, { fontSize: 12 }]}>
              To send to one department only, add departments in Admin → Departments and put people in them.
            </Text>
          )}
          {count !== null && count > 0 && (
            <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={2}>
              To: {shownNames.join(', ')}
              {count > shownNames.length ? ` and ${count - shownNames.length} more` : ''}
            </Text>
          )}
        </View>
        <TextInput
          style={[s.input, { minHeight: 160, textAlignVertical: 'top', lineHeight: 21 }]}
          value={text}
          onChangeText={setText}
          placeholder="Write your announcement…"
          placeholderTextColor={colors.faint}
          multiline
          autoFocus
        />
        <View style={[s.row, { gap: 8 }]}>
          <Pressable
            onPress={() => setChoosing(true)}
            style={({ pressed }) => [
              s.row,
              {
                flex: 1,
                gap: 10,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.lineStrong,
                borderRadius: 12,
                paddingHorizontal: 14,
                minHeight: 48,
                backgroundColor: colors.surface,
              },
              pressed && { backgroundColor: colors.hover },
            ]}
          >
            <Paperclip size={18} color={colors.muted} />
            <Text style={[s.text, { flex: 1, color: colors.text2 }]} numberOfLines={1}>
              {file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo, PDF or file'}
            </Text>
          </Pressable>
          {file && <IconButton icon={X} label="Remove file" onPress={() => setFile(null)} />}
        </View>
        <Button
          variant="primary"
          icon={Send}
          title={only.length ? `Send to ${only.length === 1 ? only[0] : `${only.length} departments`}` : 'Send to everyone'}
          busy={busy}
          disabled={disabled}
          onPress={send}
        />
      </ScrollView>

      {choosing && (
        <Sheet
          title="Attach"
          onClose={() => setChoosing(false)}
          actions={[
            { icon: Image, label: 'Photo', onPress: () => void load('photo') },
            { icon: FileText, label: 'PDF document', onPress: () => void load('pdf') },
            { icon: File, label: 'Other file', onPress: () => void load('file') },
          ]}
        />
      )}
    </View>
  );
}

export function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ selected: active, disabled }}
      style={{
        opacity: disabled ? 0.45 : 1,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? '#b9cbf7' : colors.lineStrong,
        backgroundColor: active ? colors.accentSoft : colors.surface,
      }}
    >
      <Text style={{ fontSize: 13, color: active ? colors.accentText : colors.text2, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}
