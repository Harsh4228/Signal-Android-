import type { OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { makeSticker } from '../media';
import { useEffect, useRef, useState } from 'react';

/** Emoji panel for the message box (desktop / web; phones use the keyboard's own emoji). Recent ones come first. */
const GROUPS: { name: string; icon: string; list: string }[] = [
  {
    name: 'Smileys',
    icon: '😀',
    list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬',
  },
  {
    name: 'Gestures',
    icon: '👍',
    list: '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🫶 👀 🧠 🙋 🙆 🙅 🤷 🤦 💁 🙇',
  },
  {
    name: 'Hearts',
    icon: '❤️',
    list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 💯 🔥 🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🎯',
  },
  {
    name: 'Work',
    icon: '💼',
    list: '💼 📁 📂 📄 📃 📑 📊 📈 📉 🗂️ 📅 📆 🗓️ 📌 📍 📎 🖇️ ✏️ 🖊️ 📝 📋 📦 📮 📧 📞 ☎️ 📱 💻 🖥️ 🖨️ ⌨️ 🖱️ 💡 🔧 🔨 ⚙️ 🧰 🔒 🔓 🔑 ⏰ ⏳ ⌛ ✅ ☑️ ❌ ❗ ❓ ⚠️ 🚫 🔔 📢 💬 💭',
  },
  {
    name: 'Food',
    icon: '☕',
    list: '☕ 🍵 🥤 🧃 🍺 🍰 🎂 🍫 🍪 🍩 🍕 🍔 🍟 🌭 🥪 🌮 🍜 🍝 🍛 🍚 🍱 🥗 🍎 🍌 🍉 🍇 🍓 🥭 🍍 🥥',
  },
  {
    name: 'Travel',
    icon: '🚗',
    list: '🚗 🚕 🚌 🚚 🚛 🏍️ 🚲 🛵 ✈️ 🚆 🚇 🚢 🏠 🏢 🏭 🏥 🏦 🏫 ⛽ 🗺️ 🌍 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ 🌈 🌙',
  },
];

const RECENT_KEY = 'emoji:recent';
function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function EmojiPicker({
  onPick,
  onClose,
  onSticker,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Send one of my stickers (only where files may be sent). */
  onSticker?: (s: OutgoingFile) => void;
}) {
  const [stickers, setStickers] = useState<{ id: string; mime: string; data: Uint8Array; url: string }[] | null>(null);
  useEffect(() => () => stickers?.forEach((s) => URL.revokeObjectURL(s.url)), [stickers]);
  function openStickers() {
    setTab(-2);
    void client.myStickers().then((list) => setStickers(list.map((s) => ({ ...s, url: URL.createObjectURL(new Blob([s.data as BlobPart], { type: s.mime })) }))));
  }
  async function addFromFile(f: File | undefined) {
    if (!f) return;
    try {
      await client.addSticker(await makeSticker({ name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) }));
      openStickers();
    } catch (e) {
      alert(String((e as Error)?.message ?? e));
    }
  }
  const [recent, setRecent] = useState(loadRecent);
  const [tab, setTab] = useState(() => (loadRecent().length ? -1 : 0));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Next tick, so the click that opened it doesn't close it.
    const t = setTimeout(() => window.addEventListener('mousedown', away));
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const pick = (e: string) => {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private window: no recents */
    }
    onPick(e);
  };
  const list = tab === -1 ? recent : tab === -2 ? [] : GROUPS[tab]!.list.split(' ');

  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Emoji">
      <div className="emoji-tabs">
        {recent.length > 0 && (
          <button type="button" className={tab === -1 ? 'active' : ''} title="Recent" onClick={() => setTab(-1)}>
            🕘
          </button>
        )}
        {GROUPS.map((g, i) => (
          <button type="button" key={g.name} className={tab === i ? 'active' : ''} title={g.name} onClick={() => setTab(i)}>
            {g.icon}
          </button>
        ))}
        {onSticker && (
          <button type="button" className={tab === -2 ? 'active' : ''} title="My stickers" onClick={openStickers}>
            🏷️
          </button>
        )}
      </div>
      {tab === -2 && (
        <div className="sticker-grid">
          <label className="sticker-add" title="Make a sticker from a picture">
            +
            <input type="file" accept="image/*" hidden onChange={(e) => void addFromFile(e.target.files?.[0])} />
          </label>
          {stickers?.map((s) => (
            <button
              type="button"
              key={s.id}
              title="Send (right-click to remove)"
              onClick={() => onSticker?.({ name: 'sticker.webp', mime: s.mime, data: s.data })}
              onContextMenu={(e) => {
                e.preventDefault();
                if (confirm('Remove this sticker?')) void client.removeSticker(s.id).then(openStickers);
              }}
            >
              <img src={s.url} alt="" draggable={false} />
            </button>
          ))}
          {stickers && !stickers.length && <p className="muted small">No stickers yet. Make one from a picture with +, or tap ★ on a sticker you got.</p>}
        </div>
      )}
      <div className="emoji-grid" hidden={tab === -2}>
        {list.map((e) => (
          <button type="button" key={e} onClick={() => pick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
