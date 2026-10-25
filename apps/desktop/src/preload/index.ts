import { contextBridge, ipcRenderer } from 'electron';

/**
 * The ONLY bridge between the sandboxed UI and the system: an encrypted key/value store and a folder for saved
 * chat media (the app encrypts it before it gets here). Nothing lets a file leave the app.
 */
contextBridge.exposeInMainWorld('meetme', {
  platform: process.platform,
  /** Open a shared location in Google Maps in the system browser (only exact maps links are accepted). */
  openMaps: (url: string): Promise<void> => ipcRenderer.invoke('maps:open', url),
  /** Start background update checks against <server>/updates/ (installed builds only). */
  checkUpdates: (serverUrl: string): Promise<void> => ipcRenderer.invoke('updates:check', serverUrl),
  store: {
    getItem: (key: string): Promise<string | null> => ipcRenderer.invoke('store:get', key),
    setItem: (key: string, value: string): Promise<void> => ipcRenderer.invoke('store:set', key, value),
    removeItem: (key: string): Promise<void> => ipcRenderer.invoke('store:remove', key),
    clear: (): Promise<void> => ipcRenderer.invoke('store:clear'),
  },
  media: {
    read: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('media:read', id),
    write: (id: string, data: Uint8Array): Promise<void> => ipcRenderer.invoke('media:write', id, data),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('media:remove', id),
    clear: (): Promise<void> => ipcRenderer.invoke('media:clear'),
  },
});
