import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  loadVrm: (filename: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('load-vrm', filename),
  loadConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('load-config')
})
