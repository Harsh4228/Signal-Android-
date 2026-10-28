import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Megaphone, UsersRound } from 'lucide-react-native';
import { groupKey, type ChannelInfo, type Community } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Header, errorText, useBack } from '../ui';
import type { Route } from '../App';

/**
 * Like WhatsApp's Updates / Communities: channels anyone in the company can follow (only their admins post),
 * and communities (groups and channels the admin put together).
 */
export function ChannelsScreen({ navigate, onToast }: { navigate: (r: Route) => void; onToast: (m: string) => void }) {
  const c = useClient();
  useBack(() => navigate({ name: 'list' }));
  const [channels, setChannels] = useState<ChannelInfo[] | null>(null);
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([client.listChannels(), client.listCommunities()]).then(
      ([ch, co]) => {
        setChannels(ch);
        setCommunities(co);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(load, [load]);

  async function follow(ch: ChannelInfo) {
    setBusy(ch.id);
    try {
      await client.followChannel(ch.id, !ch.following);
      onToast(ch.following ? `Left ${ch.name}` : `Following ${ch.name}`);
      load();
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  const nameOf = (id: string) => c.groupOf(groupKey(id))?.name ?? channels?.find((x) => x.id === id)?.name;

  return (
    <View style={s.fill}>
      <Header title="Channels & communities" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
        {error && <Banner kind="error">{error}</Banner>}
        <Text style={[s.section, { marginTop: 4 }]}>Channels</Text>
        {channels === null && !error && <Text style={s.muted}>Loading…</Text>}
        {channels?.length === 0 && <Text style={s.muted}>No channels yet. Your admin can create them.</Text>}
        {!!channels?.length && (
          <View style={[s.card, { overflow: 'hidden' }]}>
            {channels.map((ch, i) => (
              <View key={ch.id} style={[styles.row, i > 0 && styles.line]}>
                <View style={styles.icon}>
                  <Megaphone size={20} color={colors.accent} />
                </View>
                <Pressable style={{ flex: 1 }} disabled={!ch.following} onPress={() => navigate({ name: 'chat', peer: groupKey(ch.id) })}>
                  <Text style={s.textStrong}>{ch.name}</Text>
                  <Text style={s.muted}>
                    {ch.followers} follower{ch.followers === 1 ? '' : 's'}
                    {ch.following ? ' · tap to open' : ''}
                  </Text>
                </Pressable>
                <Button title={ch.following ? 'Following' : 'Follow'} variant={ch.following ? 'secondary' : 'primary'} busy={busy === ch.id} onPress={() => void follow(ch)} />
              </View>
            ))}
          </View>
        )}

        <Text style={s.section}>Communities</Text>
        {communities?.length === 0 && <Text style={s.muted}>No communities yet. Your admin can put groups together into one.</Text>}
        {communities?.map((co) => {
          const mine = co.groups.filter((id) => c.groupOf(groupKey(id)));
          return (
            <View key={co.id} style={[s.card, { overflow: 'hidden' }]}>
              <View style={{ padding: 14, gap: 2 }}>
                <Text style={s.title}>{co.name}</Text>
                {!!co.description && <Text style={s.muted}>{co.description}</Text>}
              </View>
              {co.groups.map((id) => {
                const inIt = mine.includes(id);
                const channel = channels?.some((x) => x.id === id);
                return (
                  <Pressable
                    key={id}
                    disabled={!inIt}
                    onPress={() => navigate({ name: 'chat', peer: groupKey(id) })}
                    style={({ pressed }) => [styles.row, styles.line, pressed && { backgroundColor: colors.hover }]}
                  >
                    {channel ? <Megaphone size={18} color={colors.muted} /> : <UsersRound size={18} color={colors.muted} />}
                    <Text style={[s.text, { flex: 1 }, !inIt && { color: colors.faint }]}>{nameOf(id) ?? 'A group you are not in'}</Text>
                    {inIt && <ChevronRight size={18} color={colors.faint} />}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
