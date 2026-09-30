import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaptureEventType, CaptureProtection } from 'react-native-capture-protection';
import { client, useCall, useClient } from './messenger';
import { colors, s } from './theme';
import { RegisterScreen } from './screens/RegisterScreen';
import { ChatListScreen } from './screens/ChatListScreen';
import { ChatScreen } from './screens/ChatScreen';
import { ChatInfoScreen } from './screens/ChatInfoScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CallScreen } from './screens/CallScreen';
import { BroadcastScreen } from './screens/BroadcastScreen';
import { MediaViewerHost } from './screens/AttachmentView';
import { EmployeesScreen } from './screens/EmployeesScreen';

export type Route =
  | { name: 'list' }
  | { name: 'chat'; peer: string }
  | { name: 'info'; peer: string }
  | { name: 'settings' }
  | { name: 'broadcast' }
  | { name: 'employees' };

export default function App() {
  const c = useClient();
  const call = useCall();
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Block screenshots, screen recording and the app-switcher preview (iOS + Android).
    CaptureProtection.prevent({
      screenshot: true,
      record: { text: 'Screen recording is blocked in MeetMe', backgroundColor: '#0b141a', textColor: '#e9edef' },
      appSwitcher: { text: 'MeetMe', backgroundColor: '#0b141a', textColor: '#e9edef' },
    }).catch(() => {});
    // iOS cannot fully stop a screenshot, so tell the other person if one happens.
    const sub = CaptureProtection.addListener((type) => {
      if (type === CaptureEventType.CAPTURED && client.activeChat) client.notifyScreenshot(client.activeChat);
    });

    client.init().then((registered) => {
      if (registered) client.connect();
      setReady(true);
    });
    const offErr = client.on('error', setToast);
    const appState = AppState.addEventListener('change', (st) => {
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
      <View style={s.center}>
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
  } else if (route.name === 'settings') {
    screen = <SettingsScreen navigate={setRoute} />;
  } else {
    screen = <ChatListScreen navigate={setRoute} onError={setToast} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.fill} edges={['top', 'bottom']}>
        {screen}
        <MediaViewerHost />
        {call.status !== 'idle' && <CallScreen />}
        {toast && (
          <View
            style={{
              position: 'absolute',
              bottom: 90,
              alignSelf: 'center',
              backgroundColor: '#33434d',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 10,
              maxWidth: '85%',
            }}
          >
            <Text style={s.text}>{toast}</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
