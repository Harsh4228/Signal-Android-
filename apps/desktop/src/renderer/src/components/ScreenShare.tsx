import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor, X } from 'lucide-react';

/** Screen sharing works in the Windows / Mac app and in desktop browsers; not on phones. */
export const canShareScreen = () => !!window.meetme.listScreens || typeof navigator.mediaDevices?.getDisplayMedia === 'function';

type Source = { id: string; name: string; thumb: string };

/** Desktop app: pick a screen or window (Electron has no picker of its own). Resolves with the source id or null. */
function choose(sources: Source[]): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (id: string | null) => {
      root.unmount();
      host.remove();
      resolve(id);
    };
    root.render(<Picker sources={sources} onDone={done} />);
  });
}

function Picker({ sources, onDone }: { sources: Source[]; onDone: (id: string | null) => void }) {
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onDone]);
  const list = sources.filter((s) => s.id.startsWith(tab));
  return (
    <div className="modal-bg screen-picker-bg" onClick={() => onDone(null)}>
      <div className="modal wide screen-picker" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Monitor size={18} />
            </span>
            Share your screen
          </div>
          <button className="icon" onClick={() => onDone(null)} title="Cancel">
            <X size={18} />
          </button>
        </header>
        <div className="tabs">
          <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}>
            Entire screen
          </button>
          <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}>
            Window
          </button>
        </div>
        <div className="screen-grid">
          {list.map((s) => (
            <button key={s.id} className="screen-item" onClick={() => onDone(s.id)} title={s.name}>
              <img src={s.thumb} alt="" draggable={false} />
              <span>{s.name}</span>
            </button>
          ))}
          {!list.length && <p className="muted">Nothing to share here.</p>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          The other person sees what you pick until you stop sharing. CellMate's own window shows black to them.
        </p>
      </div>
    </div>
  );
}

/** Ask which screen to share and return its video track, or null if the person cancelled. */
export async function pickScreenTrack(): Promise<MediaStreamTrack | null> {
  if (window.meetme.listScreens && window.meetme.chooseScreen) {
    const id = await choose(await window.meetme.listScreens());
    if (!id) return null;
    await window.meetme.chooseScreen(id);
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    const track = stream.getVideoTracks()[0] ?? null;
    // Text on a screen should stay sharp rather than smooth.
    if (track && 'contentHint' in track) track.contentHint = 'detail';
    return track;
  } catch {
    return null; // cancelled in the browser's own picker
  }
}
