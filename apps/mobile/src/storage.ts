import * as Keychain from 'react-native-keychain';
import type { SecureStorage } from '@meetme/core';

/**
 * Keys and session state are stored ONLY in the iOS Keychain / Android Keystore:
 *  - iOS: "when unlocked, this device only" -> never synced to iCloud, never in backups.
 *  - Android: AES-GCM with a hardware-backed Keystore key.
 * Nothing is written to regular files, so there is nothing for another app or a backup to read.
 */
const PREFIX = 'meetme:';

const options = (key: string) => ({
  service: PREFIX + key,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
});

export const keychainStorage: SecureStorage = {
  async getItem(key) {
    const r = await Keychain.getGenericPassword({ service: PREFIX + key });
    return r ? r.password : null;
  },
  async setItem(key, value) {
    const ok = await Keychain.setGenericPassword('meetme', value, options(key));
    if (!ok) throw new Error('Secure storage write failed');
  },
  async removeItem(key) {
    await Keychain.resetGenericPassword({ service: PREFIX + key });
  },
  async clear() {
    const services = await Keychain.getAllGenericPasswordServices({ skipUIAuth: true });
    await Promise.all(
      services.filter((s) => s.startsWith(PREFIX)).map((service) => Keychain.resetGenericPassword({ service })),
    );
  },
};
