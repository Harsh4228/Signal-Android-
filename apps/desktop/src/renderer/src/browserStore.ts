import type { SecureStorage } from '@meetme/core';

/**
 * Dev only: the UI opened in a normal browser has no Electron preload, so no encrypted store. This one uses
 * sessionStorage: each tab keeps its own login (survives reload, gone when the tab closes), so you can open
 * one tab per user. Keys sit unencrypted in the browser - never use this for real accounts.
 */
export function browserStore(): SecureStorage {
  const prefix = 'meetme:';
  return {
    getItem: async (k) => sessionStorage.getItem(prefix + k),
    setItem: async (k, v) => sessionStorage.setItem(prefix + k, v),
    removeItem: async (k) => sessionStorage.removeItem(prefix + k),
    clear: async () => {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith(prefix)) sessionStorage.removeItem(k);
    },
  };
}
