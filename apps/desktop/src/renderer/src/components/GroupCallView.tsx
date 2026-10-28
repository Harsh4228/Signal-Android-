import { useEffect, useRef, useState } from 'react';
import { Lock, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, UsersRound, Video, VideoOff } from 'lucide-react';
import { client, groupCalls, useGroupCall } from '../messenger';
import { Avatar } from './ui';

function StreamVideo({ stream, muted, mirror }: { stream: MediaStream; muted?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tracks = stream.getTracks().length;
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, tracks]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} />;
}

function useDuration(startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.floor((now - startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Group call: ringing (Join / Decline), then a tile for everyone, like WhatsApp. */
export function GroupCallView() {
  const s = useGroupCall();
  const duration = useDuration(s.startedAt);
  const [mini, setMini] = useState(false);
  useEffect(() => {
    if (s.status === 'ringing') setMini(false);
  }, [s.status]);
  const group = s.group ? client.chatTitle(s.group) : '';
  const me = client.account?.username ?? '';

  if (s.status === 'ringing') {
    return (
      <div className="call-mini" role="dialog" aria-label="Group call">
        <span className="title-icon">
          <UsersRound size={18} />
        </span>
        <div className="grow">
          <div className="name">{group}</div>
          <div className="sub">
            {s.from ? client.displayName(s.from) : 'Someone'} is calling · group {s.video ? 'video' : 'voice'} call
          </div>
        </div>
        <button className="icon hangup" title="Decline" onClick={() => void groupCalls.decline()}>
          <PhoneOff size={17} />
        </button>
        <button className="icon accept" title="Join" onClick={() => void groupCalls.join()}>
          {s.video ? <Video size={17} /> : <Phone size={17} />}
        </button>
      </div>
    );
  }

  // Remote audio keeps playing in every layout: each participant's stream stays in a (hidden) element.
  const audio = s.participants.map((p) => p.stream && <StreamVideo key={`a-${p.username}`} stream={p.stream} />);

  if (mini) {
    return (
      <div className="call-mini" role="dialog" aria-label="Group call">
        <div style={{ display: 'none' }}>{audio}</div>
        <span className="title-icon">
          <UsersRound size={18} />
        </span>
        <div className="grow">
          <div className="name">{group}</div>
          <div className="sub">
            {s.participants.length + 1} in the call · {duration}
          </div>
        </div>
        <button className="icon" title={s.muted ? 'Unmute' : 'Mute'} onClick={() => groupCalls.toggleMute()}>
          {s.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button className="icon" title="Back to the call" onClick={() => setMini(false)}>
          <Maximize2 size={17} />
        </button>
        <button className="icon hangup" title="Leave" onClick={() => void groupCalls.leave()}>
          <PhoneOff size={17} />
        </button>
      </div>
    );
  }

  const meVideo = s.video && !s.cameraOff && !!s.localStream?.getVideoTracks().length;
  const tiles = [
    { user: me, name: 'You', stream: meVideo ? (s.localStream as MediaStream) : null, muted: s.muted, self: true, waiting: false },
    ...s.participants.map((p) => ({
      user: p.username,
      name: client.displayName(p.username),
      stream: p.stream && !p.cameraOff && p.stream.getVideoTracks().length ? (p.stream as MediaStream) : null,
      muted: p.muted,
      self: false,
      waiting: !p.connected,
    })),
  ];
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  return (
    <div className="call group-call">
      <div style={{ display: 'none' }}>{audio}</div>
      <div className="call-top">
        <span className="e2e">
          <Lock size={12} /> {group} · {s.participants.length ? duration : 'Waiting for others to join…'}
        </span>
        <button className="icon" title="Minimise: keep using CellMate" onClick={() => setMini(true)}>
          <Minimize2 size={18} />
        </button>
      </div>
      <div className="gc-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {tiles.map((t) => (
          <div key={t.user} className="gc-tile">
            {t.stream ? <StreamVideo stream={t.stream} muted mirror={t.self} /> : <Avatar name={t.user} size="xl" />}
            <span className="gc-name">
              {t.muted && <MicOff size={13} />} {t.name}
              {t.waiting ? ' · connecting…' : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="call-controls">
        {s.video && (
          <button className={`round ${s.cameraOff ? '' : 'on'}`} onClick={() => groupCalls.toggleCamera()} title={s.cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {s.cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}
        <button className={`round ${s.muted ? 'on' : ''}`} onClick={() => groupCalls.toggleMute()} title={s.muted ? 'Unmute' : 'Mute'}>
          {s.muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button className="round hangup" onClick={() => void groupCalls.leave()} title="Leave the call">
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}