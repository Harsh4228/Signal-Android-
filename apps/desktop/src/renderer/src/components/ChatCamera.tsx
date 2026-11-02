import { useEffect, useRef, useState } from 'react';
import { Camera, Eye, RefreshCw, RotateCcw, SendHorizontal, X } from 'lucide-react';
import type { OutgoingFile } from '@meetme/core';

/** Photos taken in a chat are sent at most this size: sharp on any screen, small enough to send fast. */
const MAX_PX = 2048;

/**
 * Like WhatsApp's camera in a chat: take a photo with the webcam (or the phone camera in the web app), see it, add a
 * caption (and view once), send. The photo goes end-to-end encrypted like any other; nothing is saved to disk.
 */
export function ChatCamera({
  initialCaption,
  allowViewOnce,
  onSend,
  onClose,
  onError,
}: {
  initialCaption: string;
  allowViewOnce: boolean;
  onSend: (file: OutgoingFile, caption: string, viewOnce: boolean) => void;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameras, setCameras] = useState(1);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [caption, setCaption] = useState(initialCaption);
  const [viewOnce, setViewOnce] = useState(false);
  const [busy, setBusy] = useState(false);

  // The camera runs only while taking the photo (off on the preview, and when closed).
  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    let gone = false;
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: front ? 'user' : 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
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
        onError('Could not open the camera. Allow camera access for CellMate.');
        onClose();
      });
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, shot]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shot ? setShot(null) : onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shot, onClose]);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const k = Math.min(1, MAX_PX / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * k);
    canvas.height = Math.round(v.videoHeight * k);
    const g = canvas.getContext('2d')!;
    // The front camera preview is mirrored (like a mirror); keep the photo the way it looked.
    if (front) {
      g.translate(canvas.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => (b ? setShot({ blob: b, url: URL.createObjectURL(b) }) : onError('Could not take the photo')), 'image/jpeg', 0.88);
  }

  async function send() {
    if (!shot) return;
    setBusy(true);
    const name = `photo-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.jpg`;
    onSend({ name, mime: 'image/jpeg', data: new Uint8Array(await shot.blob.arrayBuffer()) }, caption.trim(), viewOnce);
    onClose();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal chat-camera" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">{shot ? 'Send photo' : 'Camera'}</div>
          <button type="button" className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="chat-camera-frame">
          {shot ? (
            <img src={shot.url} alt="" draggable={false} />
          ) : (
            <>
              <video ref={video} className={front ? 'mirror' : ''} muted playsInline />
              {!ready && <span className="muted">Opening camera…</span>}
            </>
          )}
        </div>
        {shot ? (
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" autoFocus onKeyDown={(e) => e.key === 'Enter' && void send()} />
            <div className="row" style={{ gap: 8 }}>
              <button type="button" onClick={() => setShot(null)}>
                <RotateCcw size={16} /> Take again
              </button>
              {allowViewOnce && (
                <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} style={{ width: 'auto' }} />
                  <Eye size={15} /> View once
                </label>
              )}
              <div className="grow" />
              <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
                <SendHorizontal size={16} /> Send
              </button>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
