import { NativeModules, PermissionsAndroid, Platform, Share } from 'react-native';
import { toBase64, type Attachment, type ChatMessage } from '@meetme/core';
import { client } from './messenger';

/** Native helpers for the two ways content may leave CellMate, when the admin allows it (Android). */
const Native = NativeModules.DeviceFiles as
  | {
      copyText(text: string): Promise<void>;
      saveToDownloads(name: string, mime: string, base64: string): Promise<string>;
      shareFile?(name: string, mime: string, base64: string): Promise<boolean>;
      takeShared?(): Promise<SharedIn | null>;
      setShareTargets?(json: string): Promise<void>;
    }
  | undefined;

/** What another app shared to CellMate ("Share" -> CellMate in WhatsApp, the gallery, Files...). */
export type SharedIn = {
  files: { uri: string; name: string; mime: string; size: number }[];
  text: string;
  /** iPhone: the chats already chosen in the share sheet - send right away, no picker. */
  targets?: string[];
};

/** One entry of the chat list the iPhone share sheet shows (names only, no messages). */
export type ShareTarget = { key: string; title: string; sub: string; group: boolean; files: boolean; chat: boolean };

/** Copy message text (only with the "Copy messages" right). */
export async function copyText(text: string, chat: string): Promise<void> {
  if (!client.can('copy', chat)) throw new Error('Your admin has turned off copying messages');
  if (!Native) throw new Error('Copying is not available on this phone');
  await Native.copyText(text);
}

/** Save a received file to Downloads/CellMate (only with the "Save files to the device" right). Returns where. */
export async function saveToDevice(a: Attachment, chat: string): Promise<string> {
  if (!client.can('download', chat)) throw new Error('Your admin has turned off saving files');
  if (!a.data) throw new Error('The file is not available yet');
  if (!Native) throw new Error('Saving is not available on this phone');
  if (Platform.OS === 'android' && Number(Platform.Version) < 29) {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    if (r !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('CellMate needs storage permission to save the file');
  }
  return Native.saveToDownloads(a.name || 'file', a.mime || 'application/octet-stream', toBase64(a.data));
}

/**
 * Share a message out of CellMate with the phone's share menu (WhatsApp, email...), only with the admin's
 * "Share outside CellMate" right. The admins see that it happened (never the content). False when cancelled.
 */
export async function shareOut(m: ChatMessage, chat: string): Promise<boolean> {
  if (!client.canShareOut(m, chat)) throw new Error('Your admin has not allowed sharing outside CellMate');
  const a = m.attachment;
  if (a?.data) {
    if (!Native?.shareFile) throw new Error('Update CellMate to share files');
    const done = await Native.shareFile(a.name || 'file', a.mime || 'application/octet-stream', toBase64(a.data));
    if (done !== false) client.noteSharedOut(m, chat);
    return done !== false;
  }
  const r = await Share.share({ message: m.text });
  if (r.action === Share.dismissedAction) return false;
  client.noteSharedOut(m, chat);
  return true;
}

/** What was shared to CellMate since the last call (taken only once), or null. */
export async function takeShared(): Promise<SharedIn | null> {
  const r = await Native?.takeShared?.().catch(() => null);
  return r && (r.files?.length || r.text) ? { files: r.files ?? [], text: r.text ?? '', targets: r.targets?.length ? r.targets : undefined } : null;
}

/**
 * iPhone: give the share sheet (Share -> CellMate in another app) the list to choose from: my chats, then everyone
 * else in the company. Only names, departments and whether files may be sent; kept in the folder the app shares with
 * its Share Extension. Android shares straight into the app, so it needs none.
 */
export async function setShareTargets(targets: ShareTarget[]): Promise<void> {
  if (Platform.OS !== 'ios' || !Native?.setShareTargets) return;
  await Native.setShareTargets(JSON.stringify(targets)).catch(() => {});
}
