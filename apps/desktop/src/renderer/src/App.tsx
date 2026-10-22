import { useEffect, useState } from 'react';
import { Info, LockKeyhole } from 'lucide-react';
import { appLock, client, useCall, useClient, useLock } from './messenger';
import { Register } from './components/Register';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { CallView } from './components/CallView';
import { Settings } from './components/Settings';
import { LockScreen } from './components/LockScreen';
import { NoticePopup } from './components/Notices';
import { Logo } from './components/ui';

/**
 * Desktop auto-lock: "immediately" locks when the window loses focus; otherwise the app locks after
 * the chosen time without any keyboard / mouse activity (or with the window hidden).
 */
function useAutoLock() {
  useEffect(() => {
    let lastActivity = Date.now();
    const activity = () => (lastActivity = Date.now());
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    const onBlur = () => appLock.onBackground();
    const onFocus = () => appLock.onForeground();
    const onVisibility = () => (document.hidden ? onBlur() : onFocus());
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const t = setInterval(() => {
      if (appLock.enabled && appLock.autoLockSec > 0 && Date.now() - lastActivity >= appLock.autoLockSec * 1000) {
        appLock.lock();
      }
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, activity));
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(t);
    };
  }, []);
}

export function App() {
  const c = useClient();
  const call = useCall();
  const lock = useLock();
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useAutoLock();

  useEffect(() => {
    Promise.all([client.init(), appLock.load()]).then(([registered]) => {
      if (registered) client.connect();
      setReady(true);
    });
    const offErr = client.on('error', (m) => setToast(m));
    return () => {
      offErr();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (call.status === 'idle' && call.endReason) setToast(call.endReason);
  }, [call.status, call.endReason]);

  if (!ready)
    return (
      <div className="splash">
        <Logo large />
      </div>
    );
  if (!c.account) return <Register onDone={() => client.connect()} />;

  return (
    <div className="app">
      <Sidebar onSettings={() => setShowSettings(true)} onError={setToast} />
      {c.activeChat ? (
        <ChatView key={c.activeChat} peer={c.activeChat} onError={setToast} />
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <LockKeyhole size={28} />
          </div>
          <h2>Select a conversation</h2>
          <p className="muted">Messages and calls are end-to-end encrypted.</p>
          <p className="muted small">Messages are never saved to disk; photos and documents are kept encrypted. Screenshots of this window are blocked.</p>
        </div>
      )}
      {call.status !== 'idle' && <CallView />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} onToast={setToast} />}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          <Info size={16} />
          {toast}
        </div>
      )}
      {!lock.locked && call.status === 'idle' && <NoticePopup />}
      {lock.locked && <LockScreen />}
    </div>
  );
}
