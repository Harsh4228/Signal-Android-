import * as Keychain from 'react-native-keychain';

/**
 * "Remember me" on the sign-in screen: company code, ID and password in the iOS Keychain / Android Keystore
 * (hardware-encrypted, this device only). A separate entry from the app's keys, so signing out keeps it.
 */
export interface Remembered {
  server: string;
  company: string;
  id: string;
  password: string;
}

const SERVICE = 'cellmate-remember';

export async function loadRemembered(): Promise<Remembered | null> {
  try {
    const r = await Keychain.getGenericPassword({ service: SERVICE });
    if (!r) return null;
    const v = JSON.parse(r.password) as Partial<Remembered>;
    return typeof v.id === 'string' ? { server: v.server ?? '', company: v.company ?? '', id: v.id, password: v.password ?? '' } : null;
  } catch {
    return null;
  }
}

export async function saveRemembered(v: Remembered | null): Promise<void> {
  try {
    if (!v) await Keychain.resetGenericPassword({ service: SERVICE });
    else
      await Keychain.setGenericPassword('cellmate', JSON.stringify(v), {
        service: SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      });
  } catch (e) {
    console.warn('could not save the sign-in details', e);
  }
}
