import { contextBridge, ipcRenderer } from 'electron';

/** The ONLY bridge between the sandboxed UI and the system: an encrypted key/value store. */
contextBridge.exposeInMainWorld('meetme', {
  platform: process.platform,
  store: {
    getItem: (key: string): Promise<string | null> => ipcRenderer.invoke('store:get', key),
    setItem: (key: string, value: string): Promise<void> => ipcRenderer.invoke('store:set', key, value),
    removeItem: (key: string): Promise<void> => ipcRenderer.invoke('store:remove', key),
    clear: (): Promise<void> => ipcRenderer.invoke('store:clear'),
  },
});
