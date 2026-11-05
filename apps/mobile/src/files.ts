import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { fromBase64, MAX_ATTACHMENT_BYTES, MAX_FILES_AT_ONCE, type OutgoingFile } from '@meetme/core';

export type PickKind = 'photo' | 'pdf' | 'file';

/**
 * Choose up to MAX_FILES_AT_ONCE photos and videos / PDFs / files at once (like WhatsApp) and read them into memory.
 * Files over the size limit are left out and named in `tooBig`. Empty when cancelled.
 */
export async function pickFiles(kind: PickKind): Promise<{ files: OutgoingFile[]; tooBig: string[]; extra: number }> {
  let res;
  try {
    res = await pick({
      allowMultiSelection: true,
      type: kind === 'photo' ? [types.images, types.video] : kind === 'pdf' ? [types.pdf] : [types.allFiles],
    });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return { files: [], tooBig: [], extra: 0 };
    throw e;
  }
  const chosen = res.slice(0, MAX_FILES_AT_ONCE);
  const tooBig = chosen.filter((r) => r.size && r.size > MAX_ATTACHMENT_BYTES).map((r) => r.name ?? 'file');
  const files: OutgoingFile[] = [];
  for (const r of chosen) {
    if (r.size && r.size > MAX_ATTACHMENT_BYTES) continue;
    files.push({
      name: r.name ?? 'file',
      mime: r.type ?? (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
      data: await readUri(r.uri),
    });
  }
  return { files, tooBig, extra: Math.max(0, res.length - MAX_FILES_AT_ONCE) };
}

/**
 * Let the user choose a photo / PDF / file and read it into memory.
 * Android gives a content:// URI that React Native's fetch reads directly, so no copy is made.
 * Returns null if the user cancels.
 */
export async function pickFile(kind: PickKind): Promise<OutgoingFile | null> {
  let res;
  try {
    [res] = await pick({
      type: kind === 'photo' ? [types.images] : kind === 'pdf' ? [types.pdf] : [types.allFiles],
    });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
  if (!res) return null;
  if (res.size && res.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`);
  }
  const data = await readUri(res.uri);
  return {
    name: res.name ?? 'file',
    mime: res.type ?? (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
    data,
  };
}

export async function readUri(uri: string): Promise<Uint8Array> {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
  return fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}
