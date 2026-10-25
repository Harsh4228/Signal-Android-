import { useEffect, useRef, useState } from 'react';
import { Lock, Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { calls, client, useCall } from '../messenger';
import { Avatar } from './ui';

function VideoEl({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
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
  const hasVideo = call.video && !!call.remoteStream;

  const label =
    call.status === 'incoming'
      ? `Incoming ${call.video ? 'video' : 'voice'} call`
      : call.status === 'outgoing'
        ? 'Ringing…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : duration;

  return (
    <div className={`call ${hasVideo ? 'has-video' : ''}`}>
      {hasVideo ? (
        <VideoEl stream={call.remoteStream} className="remote" />
      ) : (
        <>
          <Avatar name={call.peer ?? '?'} size="xl" />
          {/* audio-only calls still need an element to play the remote audio */}
          {call.remoteStream && <VideoEl stream={call.remoteStream} className="hidden" />}
        </>
      )}
      {call.video && call.localStream && <VideoEl stream={call.localStream} muted className="local" />}

      <div className="call-info">
        <div className="name">{call.peer ? client.displayName(call.peer) : ''}</div>
        <div className="sub">
          <Lock size={13} /> {label}
        </div>
      </div>

      <div className="call-controls">
        {call.status === 'incoming' ? (
          <>
            <button className="round hangup" onClick={() => void calls.reject()} title="Decline">
              <PhoneOff size={22} />
            </button>
            <button className="round accept" onClick={() => void calls.accept()} title="Accept">
              {call.video ? <Video size={22} /> : <Phone size={22} />}
            </button>
          </>
        ) : (
          <>
            <button
              className={`round ${call.muted ? 'on' : ''}`}
              onClick={() => calls.toggleMute()}
              title={call.muted ? 'Unmute' : 'Mute'}
            >
              {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            {call.video && (
              <button
                className={`round ${call.cameraOff ? 'on' : ''}`}
                onClick={() => calls.toggleCamera()}
                title={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {call.cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
            )}
            <button className="round hangup" onClick={() => void calls.hangup()} title="End call">
              <PhoneOff size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
