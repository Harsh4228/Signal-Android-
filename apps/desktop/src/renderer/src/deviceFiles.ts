import type { Attachment } from '@meetme/core';
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
  if (window.meetme.saveFile) return window.meetme.saveFile(a.name || 'file', a.data);
  const url = URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime || 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name || 'file';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'Downloads';
}

/** Screenshot protection follows the rights of the chat that is open. */
export function applyCaptureRight(chat: string | null) {
  void window.meetme.setCapture?.(client.can('screenshot', chat)).catch(() => {});
}
