/// <reference types="vite/client" />
import type { BlobStorage, SecureStorage } from '@meetme/core';

declare global {
  interface Window {
    meetme: {
      platform: string;
      /** Desktop app only: the saved light / dark choice, and saving a new one. */
      theme?: string;
      saveTheme?: (theme: string) => Promise<void>;
      store: SecureStorage;
      /** Desktop app only: remembered sign-in details (JSON), OS-encrypted. */
      remember?: { get(): Promise<string | null>; set(value: string | null): Promise<void> };
      /** Saved chat media (missing in the browser dev build, which keeps it in memory). */
      media?: BlobStorage;
      /** Desktop app only. */
      openMaps?: (url: string) => Promise<void>;
      /** Desktop app only. */
      checkUpdates?: (serverUrl: string) => Promise<void>;
      /** Desktop app only: the server owner's companies page in the browser. */
      openSuper?: (serverUrl: string) => Promise<void>;
      /** Desktop app only: open an http(s) link in the system browser. */
      openLink?: (url: string) => Promise<void>;
      /** Desktop app only: screenshot protection off (true) / on (false). */
      setCapture?: (allow: boolean) => Promise<void>;
      /** Desktop app only: save a file with the system save dialog; the path, or null if cancelled. */
      saveFile?: (name: string, data: Uint8Array) => Promise<string | null>;
      /** Desktop app only: files sent with Windows "Send to -> CellMate" since the last call. */
      takeShared?: () => Promise<{ files: { name: string; mime: string; data: Uint8Array }[]; text: string } | null>;
      /** Desktop app only: called when files are sent while CellMate is open. Returns the unsubscribe function. */
      onShared?: (fn: () => void) => () => void;
    };
  }
}

export {};
