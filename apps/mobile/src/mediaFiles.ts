import { Platform } from 'react-native';
import { DocumentDirectoryPath, LibraryDirectoryPath, exists, mkdir, moveFile, readFile, unlink, writeFile } from '@dr.pogodin/react-native-fs';
import { BLOB_ID_RE, fromBase64, toBase64, type BlobStorage } from '@meetme/core';

/**
 * Saved chat media, in the app's private folder (Library on iOS, so it never shows in the Files app;
 * Android backups are off for the app). The app encrypts each file with a key from the Keychain / Keystore
 * before it gets here, so these files are unreadable on their own.
 */
const dir = `${Platform.OS === 'ios' ? LibraryDirectoryPath : DocumentDirectoryPath}/media`;

function fileFor(id: string): string {
  if (!BLOB_ID_RE.test(id)) throw new Error('invalid media id');
  return `${dir}/${id}.bin`;
}

export const mediaFiles: BlobStorage = {
  async read(id) {
    const file = fileFor(id);
    if (!(await exists(file))) return null;
    return fromBase64(await readFile(file, 'base64'));
  },
  async write(id, data) {
    const file = fileFor(id);
    if (!(await exists(dir))) await mkdir(dir);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, toBase64(data), 'base64');
    if (await exists(file)) await unlink(file);
    await moveFile(tmp, file);
  },
  async remove(id) {
    const file = fileFor(id);
    if (await exists(file)) await unlink(file);
  },
  async clear() {
    if (await exists(dir)) await unlink(dir);
  },
};
