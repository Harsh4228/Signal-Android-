import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaptureEventType, CaptureProtection } from 'react-native-capture-protection';
import { Info } from 'lucide-react-native';
import { appLock, client, useCall, useClient, useLock } from './messenger';
import { colors, s } from './theme';
import { Logo } from './ui';
import { RegisterScreen } from './screens/RegisterScreen';
import { ChatListScreen } from './screens/ChatListScreen';
import { ChatScreen } from './screens/ChatScreen';
import { ChatInfoScreen } from './screens/ChatInfoScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CallScreen } from './screens/CallScreen';
import { BroadcastScreen } from './screens/BroadcastScreen';
import { MediaViewerHost } from './screens/AttachmentView';
import { EmployeesScreen } from './screens/EmployeesScreen';
import { LockScreen } from './screens/LockScreen';
import { AppLockScreen } from './screens/AppLockScreen';

export type Route =
  | { name: 'list' }
  | { name: 'chat'; peer: string }
  | { name: 'info'; peer: string }
  | { name: 'settings' }
  | { name: 'broadcast' }
  | { name: 'employees' }
  | { name: 'applock' };

export default function App() {
  const c = useClient();
  const call = useCall();
  const lock = useLock();
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Block screenshots, screen recording and the app-switcher preview (iOS + Android).
    CaptureProtection.prevent({
      screenshot: true,
      record: { text: 'Screen recording is blocked in MeetMe', backgroundColor: '#ffffff', textColor: '#101828' },
      appSwitcher: { text: 'MeetMe', backgroundColor: '#ffffff', textColor: '#101828' },
    }).catch(() => {});
    // iOS cannot fully stop a screenshot, so tell the other person if one happens.
    const sub = CaptureProtection.addListener((type) => {
      if (type === CaptureEventType.CAPTURED && client.activeChat) client.notifyScreenshot(client.activeChat);
    });

    Promise.all([client.init(), appLock.load()]).then(([registered]) => {
      if (registered) client.connect();
      setReady(true);
    });
    const offErr = client.on('error', setToast);
    const appState = AppState.addEventListener('change', (st) => {
      if (st === 'active') appLock.onForeground();
      else if (st === 'background') appLock.onBackground();
      if (st === 'active' && client.account && client.status === 'offline') client.connect();
    });
    return () => {
      if (sub) CaptureProtection.removeListener(sub);
      offErr();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (call.status === 'idle' && call.endReason) setToast(call.endReason);
  }, [call.status, call.endReason]);

  // Keep the client's "active chat" in sync (used for read receipts and unread counters).
  useEffect(() => {
    client.setActiveChat(route.name === 'chat' ? route.peer : null);
  }, [route]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'info') setRoute({ name: 'chat', peer: route.peer });
      else if (route.name !== 'list') setRoute({ name: 'list' });
      else return false;
      return true;
    });
    return () => sub.remove();
  }, [route]);

  let screen;
  if (!ready) {
    screen = (
      <View style={[s.center, { backgroundColor: colors.surface, gap: 24 }]}>
        <Logo size={64} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (!c.account) {
    screen = <RegisterScreen onDone={() => client.connect()} />;
  } else if (route.name === 'chat') {
    screen = <ChatScreen peer={route.peer} navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'info') {
    screen = <ChatInfoScreen peer={route.peer} navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'employees') {
    screen = <EmployeesScreen navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'broadcast') {
    screen = <BroadcastScreen navigate={setRoute} onDone={setToast} />;
  } else if (route.name === 'applock') {
    screen = <AppLockScreen navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'settings') {
    screen = <SettingsScreen navigate={setRoute} />;
  } else {
    screen = <ChatListScreen navigate={setRoute} onError={setToast} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={[s.fill, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
        {screen}
        <MediaViewerHost />
        {call.status !== 'idle' && <CallScreen />}
        {ready && c.account && lock.locked && <LockScreen />}
        {toast && (
          <View
            style={{
              position: 'absolute',
              bottom: 96,
              alignSelf: 'center',
              backgroundColor: colors.text,
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 12,
              maxWidth: '88%',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Info size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, flexShrink: 1 }}>{toast}</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
