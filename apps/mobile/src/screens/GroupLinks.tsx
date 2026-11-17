import { Alert, Text, View } from 'react-native';
import { Check, Link2, PhoneCall, X } from 'lucide-react-native';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, IconButton, errorText } from '../ui';
import { copyAppLink } from '../deviceFiles';

/**
 * Call link (anyone in the group) and invite link (group admins), like WhatsApp. Both only work inside CellMate for
 * people with an account at this company; an invite only asks to join, and an admin approves each request here.
 */
export function GroupLinks({ chatKey, manage, onToast }: { chatKey: string; manage: boolean; onToast: (m: string) => void }) {
  const c = useClient();
  const requests = c.joinRequests.filter((r) => r.group === chatKey);
  const copy = (link: string, what: string) =>
    void copyAppLink(link).then((how) => how === 'copied' && onToast(`${what} copied: paste it into a chat`), (e) => onToast(errorText(e)));
  const answer = (user: string, ok: boolean) =>
    void client.answerJoinRequest(chatKey, user, ok).then(
      () => onToast(ok ? `${client.displayName(user)} added` : 'Request declined'),
      (e) => onToast(errorText(e)),
    );
  return (
    <View style={[s.card, { marginTop: 16, padding: 14, gap: 10 }]}>
      <Text style={s.textStrong}>Links</Text>
      <Button icon={PhoneCall} title="Copy call link" onPress={() => copy(client.callLink(chatKey), 'Call link')} />
      {manage && <Button icon={Link2} title="Copy invite link (you approve each request)" onPress={() => copy(client.groupLink(chatKey), 'Invite link')} />}
      {(manage || c.isAdmin) && requests.length > 0 && (
        <>
          <Text style={[s.textStrong, { marginTop: 6 }]}>Join requests</Text>
          {requests.map((r) => (
            <View key={r.user} style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.textStrong}>{client.displayName(r.user)}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>{new Date(r.ts).toLocaleString()}</Text>
              </View>
              <IconButton icon={Check} label="Approve" color={colors.ok} onPress={() => answer(r.user, true)} />
              <IconButton
                icon={X}
                label="Decline"
                color={colors.danger}
                onPress={() =>
                  Alert.alert('Decline request', `Decline ${client.displayName(r.user)}?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Decline', style: 'destructive', onPress: () => answer(r.user, false) },
                  ])
                }
              />
            </View>
          ))}
        </>
      )}
    </View>
  );
}
