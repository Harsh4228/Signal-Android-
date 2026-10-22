import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BarChart3, CalendarDays, Check, Clock3, MapPin, Send, Trash2, X } from 'lucide-react-native';
import {
  MAX_EVENT_DESC,
  MAX_EVENT_PLACE,
  MAX_EVENT_TITLE,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  pollCounts,
  type ChatMessage,
  type Rsvp,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, IconButton, clock, errorText } from '../ui';

const RSVP_LABEL: Record<Rsvp, string> = { yes: 'Going', maybe: 'Maybe', no: 'Not going' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function eventWhen(start: number, end?: number): string {
  const d = new Date(start);
  const date = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!end) return `${date} · ${clock(start)}`;
  return new Date(end).toDateString() === d.toDateString() ? `${date} · ${clock(start)} – ${clock(end)}` : `${date} ${clock(start)} – ${clock(end)}`;
}

/** A poll inside a chat bubble: tap options to vote; bars and counts update live for everyone. */
export function PollView({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const c = useClient();
  const [showVotes, setShowVotes] = useState(false);
  const p = m.poll!;
  const me = c.account!.username;
  const mine = p.votes[me] ?? [];
  const counts = pollCounts(p);
  const voters = Object.keys(p.votes).length;
  const max = Math.max(1, ...counts);

  const toggle = (i: number) => {
    const next = p.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i].sort()) : mine[0] === i ? [] : [i];
    client.votePoll(chat, m.id, next).catch((e) => onError(errorText(e)));
  };

  return (
    <View style={{ minWidth: 240, gap: 2 }}>
      <View style={[s.row, { gap: 6 }]}>
        <BarChart3 size={16} color={colors.text2} />
        <Text style={[s.textStrong, { flexShrink: 1 }]}>{p.question}</Text>
      </View>
      <Text style={[s.muted, { fontSize: 12 }]}>{p.multi ? 'Select one or more' : 'Select one'}</Text>
      {p.options.map((o, i) => (
        <Pressable key={i} onPress={() => toggle(i)} disabled={c.status !== 'online'} style={[s.row, { gap: 10, paddingVertical: 6, alignItems: 'flex-start' }]}>
          <View style={[styles.check, p.multi && { borderRadius: 4 }, mine.includes(i) && styles.checked]}>
            {mine.includes(i) && <Check size={12} color="#fff" strokeWidth={3} />}
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.row}>
              <Text style={[s.text, { flex: 1 }]}>{o}</Text>
              <Text style={s.muted}>{counts[i]}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${(counts[i]! / max) * 100}%` }]} />
            </View>
          </View>
        </Pressable>
      ))}
      <Pressable onPress={() => setShowVotes(!showVotes)}>
        <Text style={styles.link}>
          {voters} {voters === 1 ? 'person' : 'people'} voted · {showVotes ? 'Hide votes' : 'View votes'}
        </Text>
      </Pressable>
      {showVotes &&
        p.options.map((o, i) => {
          const who = Object.entries(p.votes)
            .filter(([, picks]) => picks.includes(i))
            .map(([u]) => (u === me ? 'You' : u));
          return (
            <Text key={i} style={[s.muted, { fontSize: 13 }]}>
              <Text style={{ fontWeight: '600', color: colors.text2 }}>
                {o} ({who.length}):
              </Text>{' '}
              {who.join(', ') || 'No votes'}
            </Text>
          );
        })}
    </View>
  );
}

/** An event invitation inside a chat bubble, with Going / Maybe / Not going. */
export function EventView({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const c = useClient();
  const [showWho, setShowWho] = useState(false);
  const e = m.event!;
  const me = c.account!.username;
  const by = (r: Rsvp) => Object.entries(e.rsvp).filter(([, x]) => x === r).map(([u]) => (u === me ? 'You' : u));
  const d = new Date(e.start);

  return (
    <View style={{ minWidth: 250, gap: 6 }}>
      <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
        <View style={styles.date}>
          <Text style={styles.dateMonth}>{MONTHS[d.getMonth()]}</Text>
          <Text style={styles.dateDay}>{d.getDate()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.textStrong}>{e.title}</Text>
          <View style={[s.row, { gap: 4 }]}>
            <Clock3 size={12} color={colors.muted} />
            <Text style={[s.muted, { fontSize: 12, flexShrink: 1 }]}>
              {eventWhen(e.start, e.end)}
              {(e.end ?? e.start) < Date.now() ? ' · ended' : ''}
            </Text>
          </View>
          {!!e.place && (
            <View style={[s.row, { gap: 4 }]}>
              <MapPin size={12} color={colors.muted} />
              <Text style={[s.muted, { fontSize: 12, flexShrink: 1 }]}>{e.place}</Text>
            </View>
          )}
        </View>
      </View>
      {!!e.description && <Text style={[s.text, { fontSize: 14, color: colors.text2 }]}>{e.description}</Text>}
      <View style={[s.row, { gap: 6 }]}>
        {(['yes', 'maybe', 'no'] as const).map((r) => (
          <Pressable
            key={r}
            disabled={c.status !== 'online'}
            onPress={() => client.rsvpEvent(chat, m.id, r).catch((err) => onError(errorText(err)))}
            style={[styles.rsvp, e.rsvp[me] === r && styles.rsvpOn]}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: e.rsvp[me] === r ? '#067647' : colors.text2 }}>
              {RSVP_LABEL[r]}
              {by(r).length ? ` ${by(r).length}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setShowWho(!showWho)}>
        <Text style={styles.link}>{showWho ? 'Hide answers' : 'See who is coming'}</Text>
      </Pressable>
      {showWho &&
        (['yes', 'maybe', 'no'] as const).map((r) => (
          <Text key={r} style={[s.muted, { fontSize: 13 }]}>
            <Text style={{ fontWeight: '600', color: colors.text2 }}>
              {RSVP_LABEL[r]} ({by(r).length}):
            </Text>{' '}
            {by(r).join(', ') || 'Nobody'}
          </Text>
        ))}
    </View>
  );
}

/** Full-screen form inside the app window (not a RN <Modal>, so screenshots stay blocked). */
function Overlay({ title, icon: Icon, onClose, children }: { title: string; icon: typeof X; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <IconButton icon={X} label="Cancel" onPress={onClose} />
        <Icon size={20} color={colors.accent} />
        <Text style={[s.title, { flex: 1 }]}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function NewPoll({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupes = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;

  async function send() {
    setBusy(true);
    try {
      await client.sendPoll(chat, question, filled, multi);
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Overlay title="New poll" icon={BarChart3} onClose={onClose}>
      <TextInput
        style={s.input}
        value={question}
        maxLength={MAX_POLL_QUESTION}
        onChangeText={setQuestion}
        placeholder="Ask a question"
        placeholderTextColor={colors.faint}
        autoFocus
      />
      <Text style={[s.section, { marginTop: 8, marginBottom: 0 }]}>Options</Text>
      {options.map((o, i) => (
        <View key={i} style={[s.row, { gap: 4 }]}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={o}
            maxLength={MAX_POLL_OPTION}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={colors.faint}
            onChangeText={(t) => {
              const next = [...options];
              next[i] = t;
              if (i === next.length - 1 && t && next.length < MAX_POLL_OPTIONS) next.push('');
              setOptions(next);
            }}
          />
          {options.length > 2 && <IconButton icon={Trash2} label="Remove option" size={18} onPress={() => setOptions(options.filter((_, j) => j !== i))} />}
        </View>
      ))}
      {dupes && <Text style={{ color: colors.danger }}>Each option must be different.</Text>}
      <View style={[s.card, s.row, { padding: 14 }]}>
        <Text style={[s.text, { flex: 1 }]}>Allow multiple answers</Text>
        <Switch value={multi} onValueChange={setMulti} trackColor={{ true: colors.accent, false: colors.lineStrong }} thumbColor="#fff" />
      </View>
      <Button variant="primary" icon={Send} title="Send poll" busy={busy} disabled={!question.trim() || filled.length < 2 || dupes} onPress={send} />
    </Overlay>
  );
}

const dateText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-20" + "14:30" -> ms, or NaN. */
function parseLocal(date: string, time: string): number {
  const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return NaN;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  if (h > 23 || mi > 59) return NaN;
  const out = new Date(y, mo, d, h, mi);
  return out.getMonth() === mo && out.getDate() === d ? out.getTime() : NaN;
}

export function NewEvent({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const next = new Date(Math.ceil(Date.now() / 3600_000) * 3600_000);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(dateText(next));
  const [time, setTime] = useState(`${pad(next.getHours())}:00`);
  const [endTime, setEndTime] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const start = parseLocal(date, time);
  const end = endTime.trim() ? parseLocal(date, endTime) : undefined;
  const badStart = Number.isNaN(start);
  const badEnd = end !== undefined && (Number.isNaN(end) || end < start);

  async function send() {
    setBusy(true);
    try {
      await client.sendEvent(chat, { title, description, start, end, place });
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  const quick = (days: number) => setDate(dateText(new Date(Date.now() + days * 86400_000)));
  return (
    <Overlay title="New event" icon={CalendarDays} onClose={onClose}>
      <TextInput style={s.input} value={title} maxLength={MAX_EVENT_TITLE} onChangeText={setTitle} placeholder="Event name" placeholderTextColor={colors.faint} autoFocus />
      <TextInput
        style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
        value={description}
        maxLength={MAX_EVENT_DESC}
        onChangeText={setDescription}
        placeholder="Description (optional)"
        placeholderTextColor={colors.faint}
        multiline
      />
      <Text style={s.label}>Date (YYYY-MM-DD)</Text>
      <View style={[s.row, { gap: 6 }]}>
        <TextInput style={[s.input, { flex: 1 }]} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
        <Pressable style={styles.quick} onPress={() => quick(0)}>
          <Text style={styles.quickText}>Today</Text>
        </Pressable>
        <Pressable style={styles.quick} onPress={() => quick(1)}>
          <Text style={styles.quickText}>Tomorrow</Text>
        </Pressable>
      </View>
      <View style={[s.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Starts (HH:MM)</Text>
          <TextInput style={s.input} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Ends (optional)</Text>
          <TextInput style={s.input} value={endTime} onChangeText={setEndTime} placeholder="HH:MM" placeholderTextColor={colors.faint} keyboardType="numbers-and-punctuation" />
        </View>
      </View>
      {badStart && <Text style={{ color: colors.danger }}>Enter the date as 2026-11-20 and the time as 14:30.</Text>}
      {!badStart && badEnd && <Text style={{ color: colors.danger }}>The end must be a time after the start.</Text>}
      <TextInput style={s.input} value={place} maxLength={MAX_EVENT_PLACE} onChangeText={setPlace} placeholder="Location (optional)" placeholderTextColor={colors.faint} />
      <Button variant="primary" icon={Send} title="Send invitation" busy={busy} disabled={!title.trim() || badStart || badEnd} onPress={send} />
    </Overlay>
  );
}

const styles = StyleSheet.create({
  check: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.ok, borderColor: colors.ok },
  bar: { height: 5, marginTop: 5, borderRadius: 3, backgroundColor: 'rgba(16,24,40,0.08)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.ok },
  link: { color: colors.accent, fontSize: 13, fontWeight: '500', paddingVertical: 4 },
  date: { width: 46, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  dateMonth: { textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#fff', backgroundColor: colors.danger, paddingVertical: 1 },
  dateDay: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: 2 },
  rsvp: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  rsvpOn: { backgroundColor: colors.okSoft, borderColor: '#abefc6' },
  quick: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accentSoft },
  quickText: { color: colors.accentText, fontWeight: '600', fontSize: 13 },
});
