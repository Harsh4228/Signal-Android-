import { NativeModules } from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { fromBase64, type OutgoingFile } from '@meetme/core';

/** An upright copy of a picture made for the cropper (pixels, file in the app's cache). */
export type PreparedPhoto = { uri: string; width: number; height: number };
/** The square the person chose, in pixels of the PreparedPhoto. */
export type CropSquare = { x: number; y: number; side: number };

const Native = NativeModules.DeviceFiles as
  | {
      shrinkPhoto?(uri: string, max: number): Promise<string>;
      preparePhoto?(uri: string, max: number): Promise<PreparedPhoto>;
      cropPhoto?(uri: string, x: number, y: number, side: number, max: number): Promise<string>;
    }
  | undefined;

/** Profile photos are kept this size: sharp on every screen, small enough to load fast. */
const PROFILE_PX = 640;
/** The copy shown in the cropper: sharp enough to zoom in 4x on a 640 px result. */
const CROP_SOURCE_PX = 2048;

/** Set by <PhotoCropHost /> (mounted once in App): shows the cropper and resolves the square, or null if cancelled. */
let openCropper: ((photo: PreparedPhoto, title: string) => Promise<CropSquare | null>) | null = null;
export function setCropper(fn: typeof openCropper) {
  openCropper = fn;
}

/** A photo file (camera or gallery) as a profile photo: upright, the middle square, at most 640 px, JPEG. */
export async function profilePhotoFrom(uri: string): Promise<OutgoingFile> {
  if (!Native?.shrinkPhoto) throw new Error('Update CellMate to use this');
  const b64 = await Native.shrinkPhoto(uri, PROFILE_PX);
  return { name: 'photo.jpg', mime: 'image/jpeg', data: fromBase64(b64) };
}

/**
 * Like WhatsApp: the person moves and zooms the picture in a round frame, then gets that square
 * (at most 640 px, JPEG). Null if they cancel.
 */
export async function croppedPhotoFrom(uri: string, title: string): Promise<OutgoingFile | null> {
  if (!Native?.preparePhoto || !Native.cropPhoto || !openCropper) return profilePhotoFrom(uri);
  const photo = await Native.preparePhoto(uri, CROP_SOURCE_PX);
  const square = await openCropper(photo, title);
  if (!square) return null;
  const b64 = await Native.cropPhoto(photo.uri, Math.round(square.x), Math.round(square.y), Math.round(square.side), PROFILE_PX);
  return { name: 'photo.jpg', mime: 'image/jpeg', data: fromBase64(b64) };
}

/**
 * Choose a picture from the phone for a profile or group photo; null if cancelled.
 * With crop (the default) the person frames it first; without, the middle square is taken (e.g. a logo).
 */
export async function pickProfilePhoto(opts: { title?: string; crop?: boolean } = {}): Promise<OutgoingFile | null> {
  let res;
  try {
    [res] = await pick({ type: [types.images] });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
  if (!res) return null;
  return opts.crop === false ? profilePhotoFrom(res.uri) : croppedPhotoFrom(res.uri, opts.title ?? 'Move and zoom');
}
