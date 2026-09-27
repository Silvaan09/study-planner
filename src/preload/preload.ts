import { contextBridge, ipcRenderer } from 'electron';

// Exposes a single, narrow entry point. The renderer never sees Node or the database.
contextBridge.exposeInMainWorld('studyApi', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
});
