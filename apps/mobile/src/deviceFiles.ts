import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { toBase64, type Attachment } from '@meetme/core';
import { client } from './messenger';

/** Native helpers for the two ways content may leave CellMate, when the admin allows it (Android). */
const Native = NativeModules.DeviceFiles as
  | { copyText(text: string): Promise<void>; saveToDownloads(name: string, mime: string, base64: string): Promise<string> }
  | undefined;

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
