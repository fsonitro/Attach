// This file is used to expose certain APIs to the renderer process securely, allowing communication between the main and renderer processes.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    mountShare: (sharePath: string, username: string, password: string) => 
        ipcRenderer.invoke('mount-share', sharePath, username, password),
    unmountShare: (label: string) => 
        ipcRenderer.invoke('unmount-share', label),
    getMountedShares: () => 
        ipcRenderer.invoke('get-mounted-shares'),
});