import { useEffect, useRef, useState } from 'react';
import { Lock, Maximize2, MessageSquareText, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { calls, client, useCall } from '../messenger';
import { Avatar, errorText } from './ui';

/** Quick answers when you can't pick up, like WhatsApp's "Decline with message". */
const QUICK_REPLIES = ["Can't talk now. What's up?", "I'll call you right back.", "I'll call you later.", "Can't talk now. Call me later?"];

function VideoEl({ stream, muted, className, onClick }: { stream: MediaStream | null; muted?: boolean; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tracks = stream?.getTracks().length ?? 0;
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, tracks]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} onClick={onClick} />;
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
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}

export function CallView() {
  const call = useCall();
  const duration = useDuration(call.startedAt);
  const [mini, setMini] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [replying, setReplying] = useState(false);
  // A new call always opens full size.
  useEffect(() => {
    if (call.status === 'incoming' || call.status === 'outgoing') setMini(false);
  }, [call.status]);

  const name = call.peer ? client.displayName(call.peer) : '';
  const localVideo = call.video && !!call.localStream && !call.cameraOff && call.localStream.getVideoTracks().length > 0;
  const remoteVideo = call.video && !!call.remoteStream && !call.peerCameraOff && call.remoteStream.getVideoTracks().length > 0;
  const bigLocal = swapped && localVideo && remoteVideo;
  const label =
    call.status === 'incoming'
      ? `Incoming ${call.video ? 'video' : 'voice'} call`
      : call.status === 'outgoing'
        ? call.ringing
          ? 'Ringing…'
          : 'Calling…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : call.reconnecting
            ? 'Reconnecting…'
            : duration;

  async function declineWith(text: string) {
    const peer = call.peer;
    setReplying(false);
    await calls.reject();
    if (peer) await client.sendText(peer, text).catch((e) => console.warn('quick reply failed', errorText(e)));
  }

  // The remote audio must keep playing in every layout, so this element is always there.
  const audio = call.remoteStream && !remoteVideo && <VideoEl stream={call.remoteStream} className="hidden" />;

  if (mini) {
    return (
      <div className="call-mini" role="dialog" aria-label="Call">
        {audio}
        {remoteVideo ? <VideoEl stream={call.remoteStream} className="mini-video" /> : <Avatar name={call.peer ?? '?'} />}
        <div className="grow">
          <div className="name">{name}</div>
          <div className={`sub ${call.reconnecting ? 'warn' : ''}`}>{label}</div>
        </div>
        <button className="icon" title={call.muted ? 'Unmute' : 'Mute'} onClick={() => calls.toggleMute()}>
          {call.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button className="icon" title="Back to the call" onClick={() => setMini(false)}>
          <Maximize2 size={17} />
        </button>
        <button className="icon hangup" title="End call" onClick={() => void calls.hangup()}>
          <PhoneOff size={17} />
        </button>
      </div>
    );
  }

  return (
    <div className={`call ${remoteVideo ? 'has-video' : ''}`}>
      {remoteVideo ? (
        <VideoEl stream={bigLocal ? call.localStream : call.remoteStream} muted={bigLocal} className={`remote ${bigLocal ? 'mirror' : ''}`} />
      ) : (
        <Avatar name={call.peer ?? '?'} size="xl" />
      )}
      {audio}
      {localVideo && (
        <VideoEl
          stream={bigLocal ? call.remoteStream : call.localStream}
          muted={!bigLocal}
          className={`local ${bigLocal ? '' : 'mirror'}`}
          onClick={() => remoteVideo && setSwapped((v) => !v)}
        />
      )}

      <div className="call-top">
        <span className="e2e">
          <Lock size={12} /> End-to-end encrypted
        </span>
        {call.status !== 'incoming' && (
          <button className="icon" title="Minimise: keep talking while you use CellMate" onClick={() => setMini(true)}>
            <Minimize2 size={18} />
          </button>
        )}
      </div>

      <div className="call-info">
        <div className="name">{name}</div>
        <div className={`sub ${call.reconnecting ? 'warn' : ''}`}>{label}</div>
        {call.peerMuted && call.status === 'connected' && (
          <div className="chip">
            <MicOff size={13} /> {name.split(' ')[0]} muted
          </div>
        )}
      </div>

      <div className="call-controls">
        {call.status === 'incoming' ? (
          <>
            <div className="menu-host">
              <button className="round" onClick={() => setReplying((v) => !v)} title="Decline with message">
                <MessageSquareText size={22} />
              </button>
              {replying && (
                <div className="dropdown up" role="menu">
                  {QUICK_REPLIES.map((t) => (
                    <button key={t} role="menuitem" onClick={() => void declineWith(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              className={`round ${localVideo ? 'on' : ''}`}
              onClick={() => calls.toggleCamera()}
              title={localVideo ? 'Turn camera off' : 'Turn camera on'}
              disabled={call.status !== 'connected' && !call.localStream?.getVideoTracks().length}
            >
              {localVideo ? <Video size={22} /> : <VideoOff size={22} />}
            </button>
            <button className={`round ${call.muted ? 'on' : ''}`} onClick={() => calls.toggleMute()} title={call.muted ? 'Unmute' : 'Mute'}>
              {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            <button className="round hangup" onClick={() => void calls.hangup()} title="End call">
              <PhoneOff size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
