import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import type { Route } from '../App';

const TIMERS: [number, string][] = [
  [0, 'Off'],
  [30, '30 s'],
  [300, '5 min'],
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
      .catch((e) => onError(String(e?.message ?? e)));

  const current = c.getDisappearingTimer(peer);

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'chat', peer })}>
          <Text style={s.icon}>‹</Text>
        </Pressable>
        <Text style={[s.text, { fontWeight: '700', fontSize: 17 }]}>{peer}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.h4}>Safety number</Text>
        {safety ? (
          <>
            <Text
              style={{
                color: colors.text,
                fontFamily: 'monospace',
                fontSize: 17,
                lineHeight: 28,
                textAlign: 'center',
                backgroundColor: colors.panel2,
                borderRadius: 10,
                padding: 12,
              }}
            >
              {safety.number.replace(/(\S+ \S+ \S+ \S+) /g, '$1\n')}
            </Text>
            <Text style={[s.muted, { marginTop: 8 }]}>
              Compare these numbers with {peer} in person or on a video call. If they match, nobody can be
              listening in.
            </Text>
            <Pressable style={s.button} onPress={run(() => client.setVerified(peer, !safety.verified))}>
              <Text style={s.buttonText}>{safety.verified ? 'Clear verification' : 'Mark as verified ✔'}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={s.muted}>Send or receive a message first to create the secure session.</Text>
        )}

        <Text style={s.h4}>Disappearing messages</Text>
        <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
          {TIMERS.map(([v, label]) => (
            <Pressable
              key={v}
              style={[s.button, { marginTop: 0 }, current === v && s.primary]}
              onPress={run(() => client.setDisappearingTimer(peer, v))}
            >
              <Text style={s.buttonText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.h4}>Privacy</Text>
        <Pressable style={s.button} onPress={() => client.clearChat(peer)}>
          <Text style={s.buttonText}>Clear chat from memory</Text>
        </Pressable>
        <Pressable style={s.button} onPress={run(() => client.resetSession(peer))}>
          <Text style={s.buttonText}>Reset secure session</Text>
        </Pressable>
        <Pressable
          style={[s.button, s.danger]}
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
        >
          <Text style={s.buttonText}>Remove contact</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
