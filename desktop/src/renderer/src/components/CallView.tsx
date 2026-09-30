import { useEffect, useRef, useState } from 'react';
import { calls, useCall } from '../messenger';

function Video({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
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

export function CallView() {
  const call = useCall();
  const duration = useDuration(call.startedAt);

  const label =
    call.status === 'incoming'
      ? `Incoming ${call.video ? 'video' : 'voice'} call`
      : call.status === 'outgoing'
        ? 'Ringing…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : duration;

  return (
    <div className="call">
      {call.video && call.remoteStream ? (
        <Video stream={call.remoteStream} className="remote" />
      ) : (
        <>
          <div className="call-avatar">{call.peer?.[0]?.toUpperCase()}</div>
          {/* audio-only calls still need an element to play the remote audio */}
          {call.remoteStream && <Video stream={call.remoteStream} className="hidden" />}
        </>
      )}
      {call.video && call.localStream && <Video stream={call.localStream} muted className="local" />}

      <div className="call-info">
        <div className="name">{call.peer}</div>
        <div className="muted">🔒 {label}</div>
      </div>

      <div className="call-controls">
        {call.status === 'incoming' ? (
          <>
            <button className="round danger" onClick={() => void calls.reject()} title="Decline">
              ✕
            </button>
            <button className="round accept" onClick={() => void calls.accept()} title="Accept">
              ✆
            </button>
          </>
        ) : (
          <>
            <button className={`round ${call.muted ? 'on' : ''}`} onClick={() => calls.toggleMute()} title="Mute">
              {call.muted ? '🔇' : '🎤'}
            </button>
            {call.video && (
              <button
                className={`round ${call.cameraOff ? 'on' : ''}`}
                onClick={() => calls.toggleCamera()}
                title="Camera"
              >
                {call.cameraOff ? '🚫' : '📷'}
              </button>
            )}
            <button className="round danger" onClick={() => void calls.hangup()} title="Hang up">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
