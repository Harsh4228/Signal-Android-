import { useEffect, useState } from 'react';
import { client, useCall, useClient } from './messenger';
import { Register } from './components/Register';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { CallView } from './components/CallView';
import { Settings } from './components/Settings';

export function App() {
  const c = useClient();
  const call = useCall();
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    client.init().then((registered) => {
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

  if (!ready) return <div className="splash">MeetMe</div>;
  if (!c.account) return <Register onDone={() => client.connect()} />;

  return (
    <div className="app">
      <Sidebar onSettings={() => setShowSettings(true)} onError={setToast} />
      {c.activeChat ? (
        <ChatView key={c.activeChat} peer={c.activeChat} onError={setToast} />
      ) : (
        <div className="empty">
          <div className="lock">🔒</div>
          <h2>MeetMe</h2>
          <p>Messages and calls are end-to-end encrypted.</p>
          <p className="muted">Nothing is saved to disk. Screenshots of this window are blocked.</p>
        </div>
      )}
      {call.status !== 'idle' && <CallView />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
