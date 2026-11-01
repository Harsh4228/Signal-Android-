import type { Attachment, ChatMessage } from '@meetme/core';
import { client } from './messenger';

/** Copy message text (only with the "Copy messages" right). */
export async function copyText(text: string, chat: string): Promise<void> {
  if (!client.can('copy', chat)) throw new Error('Your admin has turned off copying messages');
  await navigator.clipboard.writeText(text);
}

/**
 * Save a received file to this computer (only with the "Save files to the device" right).
 * Desktop app: the system save dialog. Browser: a normal download. Resolves with where it went (null = cancelled).
 */
export async function saveToDevice(a: Attachment, chat: string): Promise<string | null> {
  if (!client.can('download', chat)) throw new Error('Your admin has turned off saving files');
  if (!a.data) throw new Error('The file is not available yet');
  return writeOut(a);
}

/** The desktop app's save dialog, or a browser download. */
async function writeOut(a: Attachment): Promise<string | null> {
  if (!a.data) throw new Error('The file is not available yet');
  if (window.meetme.saveFile) return window.meetme.saveFile(a.name || 'file', a.data);
  const url = URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime || 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name || 'file';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'Downloads';
}

/** Whether this browser has a share menu for files (phones; Chrome / Edge on Windows and Mac). */
export const hasShareMenu = () => window.meetme.platform === 'web' && typeof navigator.share === 'function';

/**
 * Share a message out of CellMate (only with the admin's "Share outside CellMate" right). In the browser: the
 * system share menu (WhatsApp, email…) where there is one. The Windows desktop app has no share menu, so a file
 * is saved with "Save as" and text is copied, to paste wherever it should go. The admins see that it happened
 * (never the content). Resolves with what happened, or null when cancelled.
 */
export async function shareOut(m: ChatMessage, chat: string): Promise<'shared' | 'saved' | 'copied' | null> {
  if (!client.canShareOut(m, chat)) throw new Error('Your admin has not allowed sharing outside CellMate');
  const a = m.attachment;
  if (hasShareMenu()) {
    const data: ShareData = a?.data ? { files: [new File([a.data as BlobPart], a.name || 'file', { type: a.mime || 'application/octet-stream' })] } : { text: m.text };
    if (!a || !navigator.canShare || navigator.canShare(data)) {
      try {
        await navigator.share(data);
        client.noteSharedOut(m, chat);
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return null;
        if (!a) throw e;
        // This browser can't share this kind of file: save it instead.
      }
    }
  }
  if (a) {
    const where = await writeOut(a);
    if (where) client.noteSharedOut(m, chat);
    return where ? 'saved' : null;
  }
  await navigator.clipboard.writeText(m.text);
  client.noteSharedOut(m, chat);
  return 'copied';
}

/** A short line for the toast after shareOut. */
export const sharedText = (r: 'shared' | 'saved' | 'copied' | null) =>
  r === 'saved' ? 'Saved: you can now attach it in another app' : r === 'copied' ? 'Copied: paste it in another app' : r === 'shared' ? 'Shared' : '';

/** Screenshot protection follows the rights of the chat that is open. */
export function applyCaptureRight(chat: string | null) {
  void window.meetme.setCapture?.(client.can('screenshot', chat)).catch(() => {});
}
