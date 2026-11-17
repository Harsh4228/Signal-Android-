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

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
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
  const list = tab === -1 ? recent : GROUPS[tab]!.list.split(' ');

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
      </div>
      <div className="emoji-grid">
        {list.map((e) => (
          <button type="button" key={e} onClick={() => pick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
