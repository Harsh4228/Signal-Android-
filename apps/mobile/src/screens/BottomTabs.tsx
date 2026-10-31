import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, CircleDashed, MessageSquareText, Phone, RadioTower, type LucideIcon } from 'lucide-react-native';
import { useClient } from '../messenger';
import { colors } from '../theme';
import { Avatar } from '../ui';
import type { Route } from '../App';

/** The pages the bottom bar switches between, like WhatsApp's tabs. */
export const TAB_ROUTES = ['list', 'status', 'channels', 'calls', 'notices', 'settings'] as const;
type Tab = (typeof TAB_ROUTES)[number];

export function BottomTabs({ current, navigate }: { current: Tab; navigate: (r: Route) => void }) {
  const c = useClient();
  const unreadChats = c.chatKeys().filter((k) => c.getUnread(k) > 0 && !c.isArchived(k)).length;
  const tabs: { name: Tab; icon?: LucideIcon; label: string; badge?: number; dot?: boolean }[] = [
    { name: 'list', icon: MessageSquareText, label: 'Chats', badge: unreadChats },
    { name: 'status', icon: CircleDashed, label: 'Status', dot: c.unseenStatusCount > 0 },
    { name: 'channels', icon: RadioTower, label: 'Channels' },
    { name: 'calls', icon: Phone, label: 'Calls' },
    { name: 'notices', icon: Bell, label: 'Notices' },
    { name: 'settings', label: 'You' },
  ];
  return (
    <View style={styles.bar}>
      {tabs.map(({ name, icon: Icon, label, badge, dot }) => {
        const on = current === name;
        return (
          <Pressable
            key={name}
            style={styles.tab}
            onPress={() => navigate({ name } as Route)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
          >
            <View style={[styles.pill, on && { backgroundColor: colors.accentSoft }]}>
              {Icon ? <Icon size={22} color={on ? colors.accent : colors.muted} strokeWidth={on ? 2.2 : 1.9} /> : <Avatar name={c.account!.username} size={24} />}
              {!!badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
              {dot && <View style={styles.dot} />}
            </View>
            <Text style={[styles.label, on && { color: colors.text }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: 6,
    paddingBottom: 4,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  pill: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 16, minHeight: 32, justifyContent: 'center' },
  label: { fontSize: 11.5, fontWeight: '600', color: colors.muted },
  badge: {
    position: 'absolute',
    top: -3,
    left: 30,
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dot: { position: 'absolute', top: 2, right: 12, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.ok, borderWidth: 2, borderColor: colors.surface },
});
