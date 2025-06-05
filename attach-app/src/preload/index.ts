// This file is used to expose certain APIs to the renderer process securely, allowing communication between the main and renderer processes.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    // Mount operations
    mountShare: (sharePath: string, username: string, password: string, label?: string, saveCredentials?: boolean, autoMount?: boolean) => 
        ipcRenderer.invoke('mount-share', sharePath, username, password, label, saveCredentials, autoMount),
    unmountShare: (label: string) => 
        ipcRenderer.invoke('unmount-share', label),
    unmountAll: () => 
        ipcRenderer.invoke('unmount-all'),
    getMountedShares: () => 
        ipcRenderer.invoke('get-mounted-shares'),
    
    // Credential operations
    getStoredCredentials: (sharePath: string) =>
        ipcRenderer.invoke('get-stored-credentials', sharePath),
    
    // Connection management
    getSavedConnections: () =>
        ipcRenderer.invoke('get-saved-connections'),
    getRecentConnections: (limit?: number) =>
        ipcRenderer.invoke('get-recent-connections', limit),
    getConnectionCredentials: (connectionId: string) =>
        ipcRenderer.invoke('get-connection-credentials', connectionId),
    removeSavedConnection: (connectionId: string) =>
        ipcRenderer.invoke('remove-saved-connection', connectionId),
    updateConnectionAutoMount: (connectionId: string, autoMount: boolean) =>
        ipcRenderer.invoke('update-connection-auto-mount', connectionId, autoMount),
    mountSavedConnection: (connectionId: string) =>
        ipcRenderer.invoke('mount-saved-connection', connectionId),
    
    // Settings
    getAutoMountSettings: () =>
        ipcRenderer.invoke('get-auto-mount-settings'),
    updateAutoMountSettings: (settings: {autoMountEnabled?: boolean, rememberCredentials?: boolean}) =>
        ipcRenderer.invoke('update-auto-mount-settings', settings),
    
    // Window operations
    openMountWindow: () => 
        ipcRenderer.invoke('open-mount-window'),
    closeMountWindow: () => 
        ipcRenderer.invoke('close-mount-window'),
    closeMainWindow: () => 
        ipcRenderer.invoke('close-main-window'),
        
    // Folder operations (for future use)
    openInFinder: (path: string) => 
        ipcRenderer.invoke('open-in-finder', path),
    getFolderContents: (path: string) => 
        ipcRenderer.invoke('get-folder-contents', path),
});