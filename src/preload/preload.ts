import { contextBridge, ipcRenderer } from 'electron';

// Exposes a single, narrow entry point. The renderer never sees Node or the database.
contextBridge.exposeInMainWorld('studyApi', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  /** Auto-updater state changes (see src/main/updater.ts). Returns an unsubscribe function. */
  onUpdateStatus: (listener: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => listener(status);
    ipcRenderer.on('update-status', handler);
    return () => void ipcRenderer.removeListener('update-status', handler);
  },
});
