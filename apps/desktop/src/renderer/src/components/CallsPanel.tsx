import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Trash2, Video, X } from 'lucide-react';
import { callDetail, callMissed, isGroupKey } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { ChatAvatar, errorText, shortTime } from './ui';

/** All calls, newest first, with call back (like WhatsApp's Calls tab). */
export function CallsPanel({ onClose, onError }: { onClose: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const list = c.callHistory();
  const callBack = (peer: string, video: boolean) => calls.startCall(peer, video).catch((e) => onError(errorText(e)));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Phone size={18} />
            </span>
            Calls
          </div>
          {list.length > 0 && (
            <button className="icon" title="Clear call list" onClick={() => client.clearCallHistory()}>
              <Trash2 size={17} />
            </button>
          )}
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body">
          {!list.length && <p className="muted">No calls yet. Start one from a chat.</p>}
          <ul className="member-list">
            {list.map(({ chat, m }) => {
              const call = m.call!;
              const missed = callMissed(call);
              const Icon = missed ? PhoneMissed : m.outgoing ? PhoneOutgoing : PhoneIncoming;
              return (
                <li key={`${chat}:${m.id}`} className="clickable" onClick={() => (client.setActiveChat(chat), onClose())}>
                  <ChatAvatar chatKey={chat} size="sm" />
                  <div className="grow">
                    <div className={`name ${missed ? 'danger-text' : ''}`}>{c.chatTitle(chat)}</div>
                    <div className="profile-line">
                      <Icon size={12} /> {shortTime(m.ts)}
                      {callDetail(call) ? ` · ${callDetail(call)}` : ''}
                    </div>
                  </div>
                  {!isGroupKey(chat) && c.can(call.video ? 'videoCall' : 'voiceCall', chat) && (
                    <button
                      className="icon"
                      title="Call back"
                      onClick={(e) => {
                        e.stopPropagation();
                        void callBack(chat, call.video);
                      }}
                    >
                      {call.video ? <Video size={17} /> : <Phone size={17} />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}