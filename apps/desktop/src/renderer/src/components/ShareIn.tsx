import { useState } from 'react';
import { File, FileText, Image as ImageIcon, Mic, Send, Video } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '@meetme/core';
import { client } from '../messenger';
import type { SharedIn } from '../shareIn';
import { errorText } from './ui';
import { SendPicker } from './SendPicker';

const iconFor = (mime: string) =>
  mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Video : mime.startsWith('audio/') ? Mic : mime === 'application/pdf' ? FileText : File;

/**
 * Something was shared to CellMate from outside (the web app on Android, or Windows "Send to"): choose the chats -
 * also any colleague I never chatted with - and send it end-to-end encrypted. Follows the admin's
 * "Send photos & files" right and group sender rules.
 */
export function ShareInModal({ shared, onClose, onToast }: { shared: SharedIn; onClose: () => void; onToast: (m: string) => void }) {
  const [text, setText] = useState(shared.text);
  const files = shared.files;
  const ok = files.filter((f) => f.data.length <= MAX_ATTACHMENT_BYTES);
  const nothing = !ok.length && !text.trim();

  async function send(picked: string[]) {
    const message = text.trim();
    let failed = 0;
    for (const key of picked) {
      try {
        // The message goes with the first file as its caption, or on its own.
        for (let i = 0; i < ok.length; i++) await client.sendFile(key, ok[i]!, i === 0 ? message : '');
        if (!ok.length && message) await client.sendText(key, message);
      } catch (e) {
        failed++;
        if (picked.length === 1) onToast(errorText(e));
      }
    }
    if (!(failed && picked.length === 1)) {
      onToast(failed ? `Sent to ${picked.length - failed}; ${failed} failed` : `Sent to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
    }
    if (picked.length === 1 && !failed) client.setActiveChat(picked[0]!);
    onClose();
  }

  return (
    <SendPicker
      title="Send to…"
      icon={<Send size={16} />}
      files={files.length > 0}
      submit={(n) => `Send${n > 1 ? ` to ${n} chats` : ''}`}
      disabled={nothing}
      onSend={send}
      onClose={onClose}
      top={
        <>
          {files.length > 0 && (
            <ul className="share-files">
              {files.slice(0, 6).map((f, i) => {
                const Icon = iconFor(f.mime);
                const big = f.data.length > MAX_ATTACHMENT_BYTES;
                return (
                  <li key={i} className={big ? 'danger-text' : undefined}>
                    <Icon size={16} />
                    <span className="grow">{f.name}</span>
                    <span className="small muted">{big ? `over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB, not sent` : formatBytes(f.data.length)}</span>
                  </li>
                );
              })}
              {files.length > 6 && <li className="muted small">and {files.length - 6} more</li>}
            </ul>
          )}
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={files.length ? 'Add a message (optional)' : 'Message'} />
        </>
      }
    />
  );
}
