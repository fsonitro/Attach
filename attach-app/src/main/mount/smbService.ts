// src/main/mount/smbService.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import keytar from 'keytar';

const execPromise = promisify(exec);

// Function to mount an SMB share
export const mountSMBShare = async (sharePath: string, username: string, password: string): Promise<string> => {
    const mountPoint = `/Volumes/${username}-${Date.now()}`; // Unique mount point
    const command = `mount_smbfs //${username}:${password}@${sharePath} ${mountPoint}`;

    try {
        await execPromise(command);
        return mountPoint; // Return the mount point on success
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to mount SMB share: ${errorMessage}`);
    }
};

// Function to unmount an SMB share
export const unmountSMBShare = async (mountPoint: string): Promise<void> => {
    const command = `umount ${mountPoint}`;

    try {
        await execPromise(command);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to unmount SMB share: ${errorMessage}`);
    }
};

// Function to store credentials securely
export const storeCredentials = async (service: string, username: string, password: string): Promise<void> => {
    await keytar.setPassword(service, username, password);
};

// Function to retrieve stored credentials
export const getStoredCredentials = async (service: string, username: string): Promise<string | null> => {
    return await keytar.getPassword(service, username);
};