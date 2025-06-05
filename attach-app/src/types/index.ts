// This file defines TypeScript types and interfaces used throughout the application.

export interface Credentials {
    username: string;
    password: string;
    smbSharePath: string;
}

export interface MountedShare {
    label: string;
    path: string;
    isMounted: boolean;
}

export interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    path: string;
}