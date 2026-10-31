import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, KeyboardAvoidingView, Platform, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaptureEventType, CaptureProtection } from 'react-native-capture-protection';
import { Info } from 'lucide-react-native';
import { appLock, calls, client, groupCalls, startClient, useCall, useClient, useGroupCall, useLock } from './messenger';
import { setupCallNotifications } from './callNotify';
import { colors, isDark, s } from './theme';
import { Logo } from './ui';
import { clearNotifications, registerPush } from './push';
import { RegisterScreen } from './screens/RegisterScreen';
import { ChatListScreen } from './screens/ChatListScreen';
import { DirectoryScreen, openDirectChat } from './screens/DirectoryScreen';
import { ChatScreen } from './screens/ChatScreen';
import { ChatInfoScreen } from './screens/ChatInfoScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { PendingScreen } from './screens/PendingScreen';
import { CallBar, CallScreen } from './screens/CallScreen';
import { GroupCallBar, GroupCallScreen } from './screens/GroupCallScreen';
import { BroadcastScreen } from './screens/BroadcastScreen';
import { MediaViewerHost } from './screens/AttachmentView';
import { AdminScreen } from './screens/AdminScreen';
import { LockScreen } from './screens/LockScreen';
import { AppLockScreen } from './screens/AppLockScreen';
import { NewNoticeScreen, NoticePopup, NoticesScreen } from './screens/NoticesScreen';
import { MediaScreen } from './screens/MediaScreen';
import { StatusComposeScreen, StatusScreen, StatusViewerScreen } from './screens/StatusScreen';
import { CatalogScreen, StarredScreen } from './screens/ChatExtras';
import { HelpDeskScreen } from './screens/HelpDesk';
import { CallsScreen } from './screens/CallsScreen';
import { ChannelsScreen } from './screens/ChannelsScreen';
import { BottomTabs, TAB_ROUTES } from './screens/BottomTabs';

export type Route =
  | { name: 'list' }
  | { name: 'contacts' }
  | { name: 'chat'; peer: string }
  | { name: 'info'; peer: string }
  | { name: 'media'; peer: string }
  | { name: 'settings' }
  | { name: 'broadcast' }
  | { name: 'admin' }
  | { name: 'starred' }
  | { name: 'catalog' }
  | { name: 'status' }
  | { name: 'status-new'; mode: 'text' | 'photo' }
  | { name: 'status-view'; user: string; start: number }
  | { name: 'notices' }
  | { name: 'notice-new' }
  | { name: 'applock' }
  | { name: 'help' }
  | { name: 'calls' }
  | { name: 'channels' };

export default function App() {
  const c = useClient();
  const call = useCall();
  const lock = useLock();
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const [toast, setToast] = useState<string | null>(null);
  /** The call screen is minimised (back to the chats while the call goes on). A new call always shows it again. */
  const [callHidden, setCallHidden] = useState(false);
  const groupCall = useGroupCall();
  const [groupHidden, setGroupHidden] = useState(false);
  useEffect(() => {
    if (groupCall.status === 'idle' || groupCall.status === 'ringing') setGroupHidden(false);
  }, [groupCall.status]);
  useEffect(() => {
    if (call.status === 'idle' || call.status === 'incoming') setCallHidden(false);
  }, [call.status]);

  useEffect(() => {
    // iOS cannot fully stop a screenshot, so tell the other person if one happens.
    const sub = CaptureProtection.addListener((type) => {
      if (type === CaptureEventType.CAPTURED && client.activeChat) client.notifyScreenshot(client.activeChat);
    });

    setupCallNotifications();
    void startClient().then(() => setReady(true));
    const offErr = client.on('error', setToast);
    const appState = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        appLock.onForeground();
        clearNotifications();
      } else if (st === 'background') {
        appLock.onBackground();
        const flushed = client.flushHistory().catch(() => {}); // the newest chats into the device file and the backup
        // iOS freezes a background app within seconds, its connection looking alive to the server for a while:
        // close it, so the server knows to wake this iPhone with a push. Not during a call (it keeps running).
        if (Platform.OS === 'ios')
          void flushed.then(() => {
            if (AppState.currentState === 'background' && calls.state.status === 'idle' && groupCalls.state.status === 'idle') client.disconnect();
          });
      }
      if (st === 'active' && client.account && client.status === 'offline') client.connect();
    });
    return () => {
      if (sub) CaptureProtection.removeListener(sub);
      offErr();
      appState.remove();
    };
  }, []);

  // Once signed in and connected, register this phone for content-free wake-up pushes.
  useEffect(() => {
    if (c.account && c.status === 'online') void registerPush(client);
  }, [c.account, c.status]);

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

  // Screenshots, screen recording and the app-switcher preview are blocked unless the admin allows screenshots
  // (for me, or in the chat that is open).
  const chatOpen = route.name === 'chat' || route.name === 'info' || route.name === 'media' ? route.peer : null;
  const mayCapture = c.account ? client.can('screenshot', chatOpen) : false;
  useEffect(() => {
    const done = mayCapture
      ? CaptureProtection.allow()
      : CaptureProtection.prevent({
          screenshot: true,
          record: { text: 'Screen recording is blocked in CellMate', backgroundColor: '#ffffff', textColor: '#101828' },
          appSwitcher: { text: 'CellMate', backgroundColor: '#ffffff', textColor: '#101828' },
        });
    done.catch(() => {});
  }, [mayCapture]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (call.status !== 'idle' && !callHidden) setCallHidden(true);
      else if (groupCall.status !== 'idle' && !groupHidden) setGroupHidden(true);
      else if (route.name === 'info') setRoute({ name: 'chat', peer: route.peer });
      else if (route.name === 'media') setRoute({ name: 'info', peer: route.peer });
      else if (route.name === 'notice-new') setRoute({ name: 'notices' });
      else if (route.name === 'status-new' || route.name === 'status-view') setRoute({ name: 'status' });
      else if (route.name !== 'list') setRoute({ name: 'list' });
      else return false;
      return true;
    });
    return () => sub.remove();
  }, [route, call.status, callHidden, groupCall.status, groupHidden]);

  const tab = (TAB_ROUTES as readonly string[]).includes(route.name) ? (route.name as (typeof TAB_ROUTES)[number]) : null;
  let screen;
  if (!ready) {
    screen = (
      <View style={[s.center, { backgroundColor: colors.surface, gap: 24 }]}>
        <Logo size={64} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (!c.account || c.moved) {
    screen = <RegisterScreen moved={!!c.account} onDone={() => client.connect()} />;
  } else if (c.pending) {
    screen = <PendingScreen />;
  } else if (route.name === 'chat') {
    screen = <ChatScreen peer={route.peer} navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'info') {
    screen = <ChatInfoScreen peer={route.peer} navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'media') {
    screen = <MediaScreen chatKey={route.peer} navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'admin') {
    screen = <AdminScreen navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'broadcast') {
    screen = <BroadcastScreen navigate={setRoute} onDone={setToast} />;
  } else if (route.name === 'contacts') {
    screen = <DirectoryScreen navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'starred') {
    screen = <StarredScreen navigate={setRoute} />;
  } else if (route.name === 'catalog') {
    screen = <CatalogScreen onClose={() => setRoute({ name: 'list' })} onToast={setToast} />;
  } else if (route.name === 'status') {
    screen = <StatusScreen navigate={setRoute} />;
  } else if (route.name === 'status-new') {
    screen = <StatusComposeScreen mode={route.mode} navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'status-view') {
    screen = <StatusViewerScreen user={route.user} start={route.start} navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'notices') {
    screen = <NoticesScreen navigate={setRoute} />;
  } else if (route.name === 'notice-new') {
    screen = <NewNoticeScreen navigate={setRoute} onDone={setToast} />;
  } else if (route.name === 'applock') {
    screen = <AppLockScreen navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'channels') {
    screen = <ChannelsScreen navigate={setRoute} onToast={setToast} />;
  } else if (route.name === 'calls') {
    screen = <CallsScreen navigate={setRoute} onError={setToast} />;
  } else if (route.name === 'help') {
    screen = <HelpDeskScreen onClose={() => setRoute({ name: 'list' })} onChat={(u) => void openDirectChat(u, setRoute, setToast)} />;
  } else if (route.name === 'settings') {
    screen = <SettingsScreen navigate={setRoute} />;
  } else {
    screen = <ChatListScreen navigate={setRoute} onError={setToast} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={[s.fill, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
        {/* Android draws edge-to-edge, so the window no longer shrinks for the keyboard: lift the screen ourselves. */}
        {call.status !== 'idle' && callHidden && !lock.locked && <CallBar onPress={() => setCallHidden(false)} />}
        {groupCall.status !== 'idle' && groupHidden && !lock.locked && <GroupCallBar onPress={() => setGroupHidden(false)} />}
        <KeyboardAvoidingView style={s.fill} behavior="padding">
          {screen}
        </KeyboardAvoidingView>
        {/* WhatsApp's bottom bar on the main pages (not inside a chat or a sub-page). */}
        {ready && c.account && !c.moved && !c.pending && tab && <BottomTabs current={tab} navigate={setRoute} />}
        <MediaViewerHost onToast={setToast} />
        {ready && c.account && !lock.locked && call.status === 'idle' && <NoticePopup />}
        {ready && c.account && lock.locked && <LockScreen />}
        {/* Above the lock screen, like WhatsApp: a call can be answered without unlocking the app first. */}
        {call.status !== 'idle' && !callHidden && <CallScreen onMinimize={() => setCallHidden(true)} />}
        {groupCall.status !== 'idle' && !groupHidden && <GroupCallScreen onMinimize={() => setGroupHidden(true)} />}
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
