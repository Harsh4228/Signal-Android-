import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { BadgeCheck, Check, Eraser, Lock, RotateCcw, ShieldX, UserMinus } from 'lucide-react-native';
import { client, useClient } from '../messenger';
import { colors, mono, s } from '../theme';
import { Avatar, Button, Header, Row, errorText } from '../ui';
import type { Route } from '../App';

const TIMERS: [number, string][] = [
  [0, 'Off'],
  [30, '30 seconds'],
  [300, '5 minutes'],
  [3600, '1 hour'],
  [86400, '1 day'],
  [604800, '1 week'],
];

export function ChatInfoScreen({
  peer,
  navigate,
  onError,
}: {
  peer: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  const c = useClient();
  const [safety, setSafety] = useState<{ number: string; verified: boolean } | null>(null);
  const reload = useCallback(() => void client.getSafetyNumber(peer).then(setSafety), [peer]);
  useEffect(reload, [reload]);

  const run = (fn: () => Promise<unknown>) => () =>
    fn()
      .then(reload)
      .catch((e) => onError(errorText(e)));

  const current = c.getDisappearingTimer(peer);

  return (
    <View style={s.fill}>
      <Header title="Conversation details" onBack={() => navigate({ name: 'chat', peer })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <Avatar name={peer} size={80} />
          <Text style={[s.h1, { fontSize: 20 }]}>{peer}</Text>
          <View style={[s.row, { gap: 5 }]}>
            <Lock size={12} color={colors.muted} />
            <Text style={s.muted}>End-to-end encrypted</Text>
          </View>
        </View>

        <Text style={s.section}>Safety number</Text>
        <View style={[s.card, { padding: 16 }]}>
          {safety ? (
            <>
              <Text
                style={{
                  color: colors.text2,
                  fontFamily: mono,
                  fontSize: 16,
                  lineHeight: 28,
                  letterSpacing: 1,
                  textAlign: 'center',
                  backgroundColor: colors.surface2,
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                {safety.number.replace(/(\S+ \S+ \S+ \S+) /g, '$1\n')}
              </Text>
              <Text style={[s.muted, { marginTop: 12, lineHeight: 19 }]}>
                Compare these numbers with {peer} in person or on a video call. If they match, nobody can be listening in.
              </Text>
              <Button
                style={{ marginTop: 14 }}
                variant={safety.verified ? 'secondary' : 'primary'}
                icon={safety.verified ? ShieldX : BadgeCheck}
                title={safety.verified ? 'Clear verification' : 'Mark as verified'}
                onPress={run(() => client.setVerified(peer, !safety.verified))}
              />
            </>
          ) : (
            <Text style={s.muted}>Send or receive a message first to create the secure session.</Text>
          )}
        </View>

        <Text style={s.section}>Disappearing messages</Text>
        <View style={[s.card, { paddingVertical: 4 }]}>
          {TIMERS.map(([v, label], i) => (
            <View key={v}>
              {i > 0 && <View style={[s.divider, { marginLeft: 16 }]} />}
              <Pressable
                onPress={run(() => client.setDisappearingTimer(peer, v))}
                style={({ pressed }) => [
                  s.row,
                  { paddingHorizontal: 16, paddingVertical: 13 },
                  pressed && { backgroundColor: colors.hover },
                ]}
              >
                <Text style={[s.text, { flex: 1 }]}>{label}</Text>
                {current === v && <Check size={18} color={colors.accent} strokeWidth={2.4} />}
              </Pressable>
            </View>
          ))}
        </View>

        <Text style={s.section}>Privacy</Text>
        <View style={[s.card, { padding: 4 }]}>
          <Row icon={Eraser} title="Clear chat from memory" onPress={() => client.clearChat(peer)} />
          <Row
            icon={RotateCcw}
            title="Reset secure session"
            subtitle="Starts a fresh encryption session"
            onPress={run(() => client.resetSession(peer))}
          />
          <Row
            icon={UserMinus}
            title="Remove contact"
            danger
            onPress={() =>
              Alert.alert('Remove contact', `Remove ${peer} and delete the chat?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => {
                    navigate({ name: 'list' });
                    void client.removeContact(peer);
                  },
                },
              ])
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}
