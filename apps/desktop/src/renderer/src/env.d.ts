/// <reference types="vite/client" />
import type { BlobStorage, SecureStorage } from '@meetme/core';

declare global {
  interface Window {
    meetme: {
      platform: string;
      store: SecureStorage;
      /** Saved chat media (missing in the browser dev build, which keeps it in memory). */
      media?: BlobStorage;
      /** Desktop app only. */
      openMaps?: (url: string) => Promise<void>;
    };
  }
}

export {};
