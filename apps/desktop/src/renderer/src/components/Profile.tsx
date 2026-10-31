import { useEffect, useRef, useState } from 'react';
import { Camera, Info, MessageSquare, Phone, RefreshCw, Video, X } from 'lucide-react';
import { shortId } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { Avatar, ChatAvatar, errorText } from './ui';
import { StatusViewer } from './Status';

type Toast = (m: string) => void;

/** "Info" from a profile popup: open the chat with its details panel (ChatView picks the request up). */
let infoFor = '';
export function openInfo(user: string) {
  infoFor = user;
  void client.addContact(user).then(() => {
    client.setActiveChat(user);
    window.dispatchEvent(new CustomEvent('meetme:info', { detail: user }));
  });
}
/** ChatView asks once when it opens: did a popup ask for this chat's details? */
export function takeInfoRequest(user: string): boolean {
  const asked = infoFor === user;
  if (asked) infoFor = '';
  return asked;
}

const telLink = (phone: string) => `tel:${phone.replace(/[^+\d]/g, '')}`;
export { telLink };

/**
 * Tapping someone's picture, like WhatsApp: with a status I haven't seen it plays the status; otherwise a
 * popup with their photo and buttons to message, call or see their details.
 */
export function AvatarTap({ user, size, onToast }: { user: string; size?: 'sm'; onToast: Toast }) {
  const [open, setOpen] = useState<'status' | 'photo' | null>(null);
  return (
    <>
      <span
        className="avatar-tap"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(client.statusRingOf(user) === 'new' ? 'status' : 'photo');
        }}
        title={client.statusRingOf(user) ? 'View status' : 'View photo'}
      >
        <PersonAvatar user={user} size={size} />
      </span>
      {open === 'status' && <StatusOf user={user} onClose={() => setOpen(null)} onToast={onToast} />}
      {open === 'photo' && <PhotoPopup user={user} onClose={() => setOpen(null)} onToast={onToast} />}
    </>
  );
}

/** A person's picture with the green status ring (grey once viewed) and the online dot. */
export function PersonAvatar({ user, size }: { user: string; size?: 'sm' | 'xl' }) {
  return <ChatAvatar chatKey={user} size={size} />;
}

/** Someone's statuses, from the first one I haven't viewed. */
export function StatusOf({ user, onClose, onToast }: { user: string; onClose: () => void; onToast: Toast }) {
  const [start] = useState(() => client.statusStartOf(user));
  return <StatusViewer user={user} start={start} onClose={onClose} onToast={onToast} />;
}

/** WhatsApp's profile photo popup: the photo (click for full size) and message / call / info buttons. */
export function PhotoPopup({ user, onClose, onToast }: { user: string; onClose: () => void; onToast: Toast }) {
  const c = useClient();
  const photo = c.avatarOf(user);
  const [full, setFull] = useState(false);
  const me = user === c.account?.username;
  const go = (fn: () => void) => () => (onClose(), fn());
  const call = (video: boolean) => go(() => void calls.startCall(user, video).catch((e) => onToast(errorText(e))));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="photo-popup" onClick={(e) => e.stopPropagation()}>
        <div className="photo-popup-name">{c.displayName(user)}</div>
        <button className="photo-popup-img" onClick={() => photo && setFull(true)} title={photo ? 'Full size' : undefined}>
          {photo ? <img src={photo} alt="" draggable={false} /> : <Avatar name={user} size="xl" />}
        </button>
        {!me && (
          <div className="photo-popup-actions">
            <button className="icon" title="Message" onClick={go(() => void client.addContact(user).then(() => client.setActiveChat(user)))}>
              <MessageSquare size={20} />
            </button>
            <button className="icon" title="Voice call" onClick={call(false)}>
              <Phone size={20} />
            </button>
            <button className="icon" title="Video call" onClick={call(true)}>
              <Video size={20} />
            </button>
            <button className="icon" title="Details" onClick={go(() => openInfo(user))}>
              <Info size={20} />
            </button>
          </div>
        )}
      </div>
      {full && photo && <FullPhoto src={photo} title={c.displayName(user)} onClose={() => setFull(false)} />}
    </div>
  );
}

/** The whole photo, as large as the window allows (not cut to a circle). */
export function FullPhoto({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <div className="viewer" onClick={onClose}>
      <header onClick={(e) => e.stopPropagation()}>
        <div className="grow name">{title}</div>
        <button className="icon light" title="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="viewer-body">
        <img className="viewer-image" src={src} alt="" draggable={false} onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

/** Profile details header: the full photo (not a circle, like WhatsApp), click for full size. */
export function ProfileHero({ user }: { user: string }) {
  const c = useClient();
  const photo = c.avatarOf(user);
  const [full, setFull] = useState(false);
  if (!photo) return <PersonAvatar user={user} size="xl" />;
  return (
    <>
      <button className="profile-hero" onClick={() => setFull(true)} title="Full size">
        <img src={photo} alt="" draggable={false} />
      </button>
      {full && <FullPhoto src={photo} title={c.displayName(user)} onClose={() => setFull(false)} />}
    </>
  );
}

/** "@ravi kumar": the sign-in ID under a name. */
export const idLine = (user: string) => `@${shortId(user)}`;

/**
 * Take a profile photo with the camera (webcam or phone camera). Returns a square JPEG of the middle of the
 * picture, as the person saw it in the preview.
 */
export function CameraCapture({ onPhoto, onClose, onError }: { onPhoto: (photo: Blob) => void; onClose: () => void; onError: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState(true);
  const [ready, setReady] = useState(false);
  const [cameras, setCameras] = useState(1);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then(async (s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.current!.srcObject = s;
        await video.current!.play().catch(() => {});
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCameras(devices.filter((d) => d.kind === 'videoinput').length);
      })
      .catch(() => {
        if (gone) return;
        onError('Could not open the camera. Allow camera access for CellMate, or choose a picture instead.');
        onClose();
      });
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [front]);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(side, 800);
    const g = canvas.getContext('2d')!;
    // The front camera preview is mirrored (like a mirror); keep the photo the way it looked.
    if (front) {
      g.translate(canvas.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => (b ? (onPhoto(b), onClose()) : onError('Could not take the photo')), 'image/jpeg', 0.9);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal camera-capture" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">Take photo</div>
          <button type="button" className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="camera-frame">
          <video ref={video} className={front ? 'mirror' : ''} muted playsInline />
          {!ready && <span className="muted">Opening camera…</span>}
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 12 }}>
          {cameras > 1 && (
            <button type="button" className="icon" title="Switch camera" onClick={() => setFront(!front)}>
              <RefreshCw size={20} />
            </button>
          )}
          <button type="button" className="primary shutter" disabled={!ready} onClick={snap}>
            <Camera size={18} /> Take photo
          </button>
        </div>
      </div>
    </div>
  );
}
