import { NativeModules } from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { fromBase64, type OutgoingFile } from '@meetme/core';

const Native = NativeModules.DeviceFiles as { shrinkPhoto?(uri: string, max: number): Promise<string> } | undefined;

/** Profile photos are kept this size: sharp on every screen, small enough to load fast. */
const PROFILE_PX = 640;

/** A photo file (camera or gallery) as a profile photo: upright, square, at most 640 px, JPEG. */
export async function profilePhotoFrom(uri: string): Promise<OutgoingFile> {
  if (!Native?.shrinkPhoto) throw new Error('Update CellMate to use this');
  const b64 = await Native.shrinkPhoto(uri, PROFILE_PX);
  return { name: 'photo.jpg', mime: 'image/jpeg', data: fromBase64(b64) };
}

/** Choose a picture from the phone for a profile photo; null if cancelled. */
export async function pickProfilePhoto(): Promise<OutgoingFile | null> {
  let res;
  try {
    [res] = await pick({ type: [types.images] });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
  return res ? profilePhotoFrom(res.uri) : null;
}
