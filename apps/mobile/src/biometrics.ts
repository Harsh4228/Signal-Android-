import * as Keychain from 'react-native-keychain';

/**
 * Fingerprint / Face ID unlock. A small marker item is stored in the Keychain / Keystore with
 * biometric access control; the OS only releases it after a successful fingerprint or face scan.
 * "Current set" means adding a new fingerprint or face invalidates it, so someone who adds their
 * own fingerprint to an unlocked phone cannot use it to open MeetMe.
 */
const SERVICE = 'meetme:biolock';

export async function biometryLabel(): Promise<string | null> {
  try {
    const type = await Keychain.getSupportedBiometryType();
    if (!type) return null;
    if (type === Keychain.BIOMETRY_TYPE.FACE_ID || type === Keychain.BIOMETRY_TYPE.FACE) return 'Face ID';
    if (type === Keychain.BIOMETRY_TYPE.TOUCH_ID) return 'Touch ID';
    return 'Fingerprint';
  } catch {
    return null;
  }
}

export async function enableBiometricUnlock(): Promise<boolean> {
  try {
    const ok = await Keychain.setGenericPassword('meetme', 'unlock', {
      service: SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM,
      authenticationPrompt: { title: 'Confirm to turn on biometric unlock', cancel: 'Cancel' },
    });
    return !!ok && (await verifyBiometrics('Confirm to turn on biometric unlock'));
  } catch {
    return false;
  }
}

export async function disableBiometricUnlock(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => {});
}

/** Shows the system fingerprint / Face ID prompt. Resolves false if cancelled or failed. */
export async function verifyBiometrics(title = 'Unlock MeetMe'): Promise<boolean> {
  try {
    const r = await Keychain.getGenericPassword({
      service: SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      authenticationPrompt: { title, cancel: 'Use PIN' },
    });
    return !!r && r.password === 'unlock';
  } catch {
    return false;
  }
}
