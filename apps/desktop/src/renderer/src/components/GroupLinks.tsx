import { Check, Link2, PhoneCall, X } from 'lucide-react';
import { client, useClient } from '../messenger';
import { errorText } from './ui';

async function copy(text: string, what: string, onToast: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onToast(`${what} copied: paste it into a chat`);
  } catch (e) {
    onToast(errorText(e));
  }
}

/**
 * Call link (anyone in the group) and invite link (group admins), like WhatsApp. Both only work inside CellMate for
 * people with an account at this company; an invite only asks to join, and an admin approves each request here.
 */
export function GroupLinks({ chatKey, manage, onToast }: { chatKey: string; manage: boolean; onToast: (m: string) => void }) {
  const c = useClient();
  const requests = c.joinRequests.filter((r) => r.group === chatKey);
  const answer = (user: string, ok: boolean) =>
    void client.answerJoinRequest(chatKey, user, ok).then(
      () => onToast(ok ? `${client.displayName(user)} added` : 'Request declined'),
      (e) => onToast(errorText(e)),
    );
  return (
    <>
      <div className="section-title">Links</div>
      <div className="stack">
        <button onClick={() => void copy(client.callLink(chatKey), 'Call link', onToast)}>
          <PhoneCall size={16} /> Copy call link
        </button>
        {manage && (
          <button onClick={() => void copy(client.groupLink(chatKey), 'Invite link', onToast)}>
            <Link2 size={16} /> Copy invite link (you approve each request)
          </button>
        )}
      </div>
      {(manage || c.isAdmin) && requests.length > 0 && (
        <>
          <div className="section-title">Join requests</div>
          <ul className="doc-list">
            {requests.map((r) => (
              <li key={r.user}>
                <div className="grow">
                  <div className="att-name">{client.displayName(r.user)}</div>
                  <div className="muted small">{new Date(r.ts).toLocaleString()}</div>
                </div>
                <button className="icon" title="Approve" onClick={() => answer(r.user, true)}>
                  <Check size={16} />
                </button>
                <button className="icon danger" title="Decline" onClick={() => answer(r.user, false)}>
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
