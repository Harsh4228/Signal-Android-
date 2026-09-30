import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { fromBase64, MAX_ATTACHMENT_BYTES, type OutgoingFile } from '@meetme/core';

export type PickKind = 'photo' | 'pdf' | 'file';

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

async function readUri(uri: string): Promise<Uint8Array> {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
  return fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}
