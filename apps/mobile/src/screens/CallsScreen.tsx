import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Trash2, Video } from 'lucide-react-native';
import { callDetail, callMissed, isGroupKey } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { ChatAvatar, Header, IconButton, errorText, shortTime, useBack } from '../ui';
import type { Route } from '../App';

/** All calls, newest first, with call back (like WhatsApp's Calls tab). */
export function CallsScreen({ navigate, onError }: { navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  useBack(() => navigate({ name: 'list' }));
  const list = c.callHistory();
  const callBack = (peer: string, video: boolean) => calls.startCall(peer, video).catch((e) => onError(errorText(e)));
  return (
    <View style={s.screen}>
      <Header
        title="Calls"
        onBack={() => navigate({ name: 'list' })}
        right={list.length ? <IconButton icon={Trash2} label="Clear call list" onPress={() => client.clearCallHistory()} /> : undefined}
      />
      <FlatList
        data={list}
        keyExtractor={(x) => `${x.chat}:${x.m.id}`}
        ListEmptyComponent={
          <View style={[s.center, { gap: 8, paddingTop: 80 }]}>
            <Phone size={40} color={colors.faint} />
            <Text style={s.muted}>No calls yet. Start one from a chat.</Text>
          </View>
        }
        renderItem={({ item: { chat, m } }) => {
          const call = m.call!;
          const missed = callMissed(call);
          const Icon = missed ? PhoneMissed : m.outgoing ? PhoneOutgoing : PhoneIncoming;
          return (
            <Pressable onPress={() => navigate({ name: 'chat', peer: chat })} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
              <ChatAvatar chatKey={chat} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={[s.textStrong, missed && { color: colors.danger }]} numberOfLines={1}>
                  {c.chatTitle(chat)}
                </Text>
                <View style={[s.row, { gap: 5, marginTop: 2 }]}>
                  <Icon size={14} color={missed ? colors.danger : colors.ok} />
                  <Text style={s.muted} numberOfLines={1}>
                    {shortTime(m.ts)}
                    {callDetail(call) ? ` · ${callDetail(call)}` : ''}
                  </Text>
                </View>
              </View>
              {!isGroupKey(chat) && c.can(call.video ? 'videoCall' : 'voiceCall', chat) && (
                <IconButton icon={call.video ? Video : Phone} label="Call back" color={colors.accent} onPress={() => void callBack(chat, call.video)} />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});