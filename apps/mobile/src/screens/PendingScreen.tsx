import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Hourglass } from 'lucide-react-native';
import { appLock, client, useClient } from '../messenger';
import { resetPush } from '../push';
import { colors, s } from '../theme';
import { Button } from '../ui';

/** My company asked to use the server and waits for the owner's approval. The app checks back every minute. */
export function PendingScreen() {
  const c = useClient();
  const [checking, setChecking] = useState(false);

  function checkNow() {
    setChecking(true);
    client.disconnect();
    client.connect();
    setTimeout(() => setChecking(false), 2500);
  }

  const cancel = () =>
    Alert.alert('Cancel the request?', 'You are signed out on this phone. Your request stays with the server owner.', [
      { text: 'Keep waiting', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          resetPush();
          void client.logout().then(() => appLock.load());
        },
      },
    ]);

  return (
    <View style={[s.center, { backgroundColor: colors.surface, padding: 24, gap: 16 }]}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Hourglass size={34} color={colors.warn} />
      </View>
      <Text style={[s.h1, { textAlign: 'center' }]}>Waiting for approval</Text>
      <Text style={[s.muted, { textAlign: 'center', fontSize: 14.5, lineHeight: 21, maxWidth: 360 }]}>
        Your company was sent to the server owner. You can use CellMate as soon as they approve it: this screen opens the app by
        itself.
      </Text>
      {!!c.account && (
        <Text style={[s.muted, { textAlign: 'center', fontSize: 13 }]}>
          Sign in later with company code “{c.account.username.split('-').pop()}”, your ID and the password you chose.
        </Text>
      )}
      <View style={{ width: '100%', maxWidth: 360, gap: 10, marginTop: 8 }}>
        <Button variant="primary" title={checking ? 'Checking…' : 'Check now'} busy={checking} onPress={checkNow} />
        <Button title="Sign out" onPress={cancel} />
      </View>
    </View>
  );
}
