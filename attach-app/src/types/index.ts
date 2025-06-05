// This file defines TypeScript types and interfaces used throughout the application.

export interface Credentials {
    username: string;
    password: string;
    smbSharePath: string;
}

export interface MountedShare {
    label: string;
    mountPoint: string;
    sharePath: string;
    username: string;
    mountedAt: Date;
}

export interface MountResult {
    success: boolean;
    message: string;
    mountPoint?: string;
    label?: string;
}

export interface UnmountResult {
    success: boolean;
    message: string;
    results?: Array<{
        label: string;
        success: boolean;
        error?: string;
    }>;
}

export interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    path: string;
}

// Window API types
declare global {
    interface Window {
        api: {
            // Mount operations
            mountShare: (sharePath: string, username: string, password: string, label?: string, saveCredentials?: boolean) => Promise<MountResult>;
            unmountShare: (label: string) => Promise<MountResult>;
            unmountAll: () => Promise<UnmountResult>;
            getMountedShares: () => Promise<MountedShare[]>;
            
            // Credential operations
            getStoredCredentials: (sharePath: string) => Promise<{username: string, password: string} | null>;
            
            // Window operations
            openMountWindow: () => Promise<void>;
            closeMountWindow: () => Promise<void>;
            
            // Folder operations
            openInFinder: (path: string) => Promise<void>;
            getFolderContents: (path: string) => Promise<string[]>;
        };
    }
}