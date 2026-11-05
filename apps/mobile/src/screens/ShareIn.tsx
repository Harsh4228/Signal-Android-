import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { File, FileText, Image as ImageIcon, Mic, Send, Video } from 'lucide-react-native';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '@meetme/core';
import { client } from '../messenger';
import { readUri } from '../files';
import type { SharedIn } from '../deviceFiles';
import { colors, s } from '../theme';
import { errorText } from '../ui';
import { SendPicker } from './SendPicker';

const iconFor = (mime: string) =>
  mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Video : mime.startsWith('audio/') ? Mic : mime === 'application/pdf' ? FileText : File;

/** iPhone: the chats were already chosen in the share sheet - send it now, without the picker. */
export async function sendSharedNow(shared: SharedIn, onToast: (m: string) => void): Promise<string | null> {
  const picked = shared.targets ?? [];
  const ok = shared.files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
  const data = await Promise.all(ok.map(async (f) => ({ name: f.name, mime: f.mime || 'application/octet-stream', data: await readUri(f.uri) })));
  const message = shared.text.trim();
  let failed = 0;
  for (const key of picked) {
    try {
      await client.ensureChat(key);
      for (let i = 0; i < data.length; i++) await client.sendFile(key, data[i]!, i === 0 ? message : '');
      if (!data.length && message) await client.sendText(key, message);
    } catch {
      failed++;
    }
  }
  onToast(failed ? `Sent to ${picked.length - failed}; ${failed} failed` : `Sent to ${picked.length === 1 ? client.chatTitle(picked[0]!) : `${picked.length} chats`}`);
  return picked.length === 1 && !failed ? picked[0]! : null;
}

/**
 * Something was shared to CellMate from another app (WhatsApp, the gallery, Files...): choose the chats - also any
 * colleague I never chatted with - and send it, end-to-end encrypted like anything else. Follows the admin's
 * "Send photos & files" right and group sender rules.
 */
export function ShareInScreen({ shared, onClose, onSent, onToast }: { shared: SharedIn; onClose: () => void; onSent: (chat: string) => void; onToast: (m: string) => void }) {
  const [text, setText] = useState(shared.text);
  const files = shared.files;
  const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
  const nothing = !files.length && !text.trim();

  async function send(picked: string[]) {
    try {
      const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
      const data = await Promise.all(ok.map(async (f) => ({ name: f.name, mime: f.mime || 'application/octet-stream', data: await readUri(f.uri) })));
      const message = text.trim();
      let failed = 0;
      for (const key of picked) {
        try {
          // The message goes with the first file as its caption, or on its own.
          for (let i = 0; i < data.length; i++) await client.sendFile(key, data[i]!, i === 0 ? message : '');
          if (!data.length && message) await client.sendText(key, message);
        } catch {
          failed++;
        }
      }
      onToast(failed ? `Sent to ${picked.length - failed}; ${failed} failed` : `Sent to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
      if (picked.length === 1 && !failed) onSent(picked[0]!);
      else onClose();
    } catch (e) {
      onToast(errorText(e));
    }
  }

  return (
    <SendPicker
      title="Send to…"
      icon={Send}
      files={files.length > 0}
      submit={(n) => `Send${n > 1 ? ` to ${n} chats` : ''}`}
      disabled={nothing || (files.length > 0 && tooBig.length === files.length)}
      onSend={send}
      onClose={onClose}
      top={
        <>
          {files.slice(0, 4).map((f, i) => {
            const Icon = iconFor(f.mime);
            return (
              <View key={i} style={[s.row, { gap: 10 }]}>
                <Icon size={18} color={colors.accent} />
                <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
                  {f.name}
                </Text>
                {f.size >= 0 && <Text style={[s.muted, { fontSize: 12 }, f.size > MAX_ATTACHMENT_BYTES && { color: colors.danger }]}>{formatBytes(f.size)}</Text>}
              </View>
            );
          })}
          {files.length > 4 && <Text style={s.muted}>and {files.length - 4} more</Text>}
          {!!tooBig.length && (
            <Text style={{ color: colors.danger, fontSize: 12 }}>
              {tooBig.length} file{tooBig.length === 1 ? ' is' : 's are'} over {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB and won't be sent
            </Text>
          )}
          <TextInput
            style={[s.input, { maxHeight: 96 }]}
            value={text}
            onChangeText={setText}
            placeholder={files.length ? 'Add a message (optional)' : 'Message'}
            placeholderTextColor={colors.faint}
            multiline
          />
        </>
      }
    />
  );
}
