/// <reference types="vite/client" />
import type { SecureStorage } from '@meetme/core';

declare global {
  interface Window {
    meetme: {
      platform: string;
      store: SecureStorage;
    };
  }
}

export {};
