// src/main/mount/smbService.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import keytar from 'keytar';

const execPromise = promisify(exec);

// Function to list available shares on a server (for validation and case correction)
export const listSMBShares = async (serverName: string, username?: string, password?: string): Promise<string[]> => {
    try {
        let command: string;
        
        if (username && password) {
            // Use authenticated connection with password piped via stdin
            const escapedPassword = password.replace(/'/g, "'\"'\"'");
            command = `echo '${escapedPassword}' | smbutil view "//${username}@${serverName}" -`;
        } else {
            // Try without authentication first (for public shares)
            command = `smbutil view "//${serverName}"`;
        }
        
        const result = await execPromise(command, { timeout: 10000 });
        const shares: string[] = [];
        const lines = result.stdout.split('\n');
        
        // Parse the output to extract share names
        let inShareList = false;
        for (const line of lines) {
            if (line.includes('shares listed')) {
                break;
            }
            if (inShareList && line.trim() && !line.includes('Type') && !line.includes('---')) {
                const shareName = line.split(/\s+/)[0];
                if (shareName && shareName !== 'Share') {
                    shares.push(shareName);
                }
            }
            if (line.includes('Share') && line.includes('Type')) {
                inShareList = true;
            }
        }
        return shares;
    } catch (error) {
        console.warn(`Failed to list shares for ${serverName}:`, error);
        return [];
    }
};

// Function to find the correct case for a share name
export const findCorrectShareCase = async (serverName: string, shareName: string, username?: string, password?: string): Promise<string> => {
    try {
        const availableShares = await listSMBShares(serverName, username, password);
        
        // First try exact match
        if (availableShares.includes(shareName)) {
            return shareName;
        }
        
        // Try case-insensitive match
        const lowerCaseTarget = shareName.toLowerCase();
        for (const share of availableShares) {
            if (share.toLowerCase() === lowerCaseTarget) {
                console.log(`Found case-corrected share: ${shareName} -> ${share}`);
                return share;
            }
        }
        
        // If no match found, return original name
        console.warn(`Share ${shareName} not found in available shares:`, availableShares);
        return shareName;
    } catch (error) {
        console.warn(`Failed to find correct case for share ${shareName}:`, error);
        return shareName;
    }
};

// Function to mount an SMB share
export const mountSMBShare = async (sharePath: string, username: string, password: string): Promise<string> => {
    // Sanitize inputs to prevent command injection
    const sanitizedUsername = username.replace(/[^a-zA-Z0-9._-]/g, '');
    
    // Properly format the share path for mount_smbfs
    // Convert smb://server/share or //server/share to server/share
    let sanitizedSharePath = sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '');
    
    // Validate inputs
    if (!sanitizedUsername || !sanitizedSharePath || !sanitizedSharePath.includes('/')) {
        throw new Error('Invalid username or share path. Share path should be in format: smb://server/share or //server/share');
    }
    
    // Extract server and share name for case correction
    const pathParts = sanitizedSharePath.split('/');
    const serverName = pathParts[0];
    const originalShareName = pathParts[1];
    
    // Try to find the correct case for the share name
    console.log(`Looking for share: ${originalShareName} on server: ${serverName}`);
    // For now, just try the common case variations to avoid interactive prompts
    let correctedShareName = originalShareName;
    if (originalShareName.toLowerCase() === 'nas') {
        correctedShareName = 'NAS'; // Common case for NAS shares
        console.log(`Applied common case correction: ${originalShareName} -> ${correctedShareName}`);
    }
    // In the future, we could add more case corrections here or implement the authenticated lookup
    // const correctedShareName = await findCorrectShareCase(serverName, originalShareName, sanitizedUsername, password);
    
    // Reconstruct the path with corrected case
    sanitizedSharePath = `${serverName}/${correctedShareName}`;
    
    const mountLabel = `${sanitizedUsername}-${Date.now()}`;
    // Use user's home directory instead of /Volumes/ to avoid sudo requirements
    const mountPoint = `${process.env.HOME}/mounts/${mountLabel}`;
    
    // Create mount point directory (no sudo needed in user's home)
    console.log(`Creating mount point: ${mountPoint}`);
    try {
        await execPromise(`mkdir -p "${mountPoint}"`, { timeout: 30000 });
    } catch (error) {
        throw new Error(`Failed to create mount point: ${mountPoint}`);
    }
    
    // Build the mount command with proper URL encoding for special characters
    // URL encode the password to handle special characters like $, {, }, =, ~, etc.
    const encodedPassword = encodeURIComponent(password);
    const command = `mount_smbfs "smb://${sanitizedUsername}:${encodedPassword}@${sanitizedSharePath}" "${mountPoint}"`;

    console.log(`Attempting to mount: //${sanitizedSharePath} as user: ${sanitizedUsername}`);
    console.log(`Mount command: mount_smbfs "smb://${sanitizedUsername}:[HIDDEN]@${sanitizedSharePath}" "${mountPoint}"`);

    try {
        const result = await execPromise(command, { timeout: 60000 }); // 60 second timeout
        console.log(`Mount successful: //${sanitizedSharePath} -> ${mountPoint}`);
        console.log(`Mount result stdout:`, result.stdout);
        
        // Verify the mount actually worked by checking if the directory is accessible
        try {
            await execPromise(`ls "${mountPoint}" > /dev/null`);
        } catch (verifyError) {
            throw new Error('Mount appeared successful but directory is not accessible');
        }
        
        return mountPoint; // Return the mount point on success
    } catch (error) {
        // Clean up the mount point if mounting failed (only if it exists)
        try {
            await execPromise(`test -d "${mountPoint}" && rmdir "${mountPoint}"`);
        } catch (cleanupError) {
            console.warn(`Failed to clean up mount point: ${mountPoint}`);
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stderr = (error as any).stderr || '';
        
        console.error(`Mount failed with error:`, errorMessage);
        console.error(`Mount stderr:`, stderr);
        
        // Provide more helpful error messages
        if (errorMessage.includes('Authentication') || stderr.includes('Authentication')) {
            throw new Error('Authentication failed. Please check your username and password.');
        } else if (errorMessage.includes('No route to host') || errorMessage.includes('could not connect') || stderr.includes('No route to host')) {
            throw new Error('Could not connect to the server. Please check the server address and network connection.');
        } else if (errorMessage.includes('Permission denied') || stderr.includes('Permission denied')) {
            throw new Error('Permission denied. Please check your credentials and access rights.');
        } else if (errorMessage.includes('timeout')) {
            throw new Error('Connection timeout. The server might be unreachable or slow to respond.');
        } else if (stderr.includes('mount_smbfs: server rejected the connection')) {
            throw new Error('Server rejected the connection. Please check the server name and share path.');
        } else if (stderr.includes('Operation not supported')) {
            throw new Error('SMB operation not supported. The server might not support SMB or the share might not exist.');
        } else {
            throw new Error(`Failed to mount SMB share: ${errorMessage}${stderr ? ` (${stderr})` : ''}`);
        }
    }
};

// Function to unmount an SMB share
export const unmountSMBShare = async (mountPoint: string): Promise<void> => {
    // Update validation to accept both old /Volumes/ paths and new ~/mounts/ paths
    const homeMountsPath = `${process.env.HOME}/mounts/`;
    if (!mountPoint || (!mountPoint.startsWith('/Volumes/') && !mountPoint.startsWith(homeMountsPath))) {
        throw new Error('Invalid mount point');
    }

    try {
        // First try a gentle unmount
        await execPromise(`umount "${mountPoint}"`, { timeout: 10000 });
        console.log(`Successfully unmounted: ${mountPoint}`);
    } catch (error) {
        console.warn(`Gentle unmount failed, trying forced unmount: ${mountPoint}`);
        try {
            // If gentle unmount fails, try forced unmount
            await execPromise(`umount -f "${mountPoint}"`, { timeout: 10000 });
            console.log(`Successfully force unmounted: ${mountPoint}`);
        } catch (forceError) {
            console.warn(`Force unmount failed, trying with sudo: ${mountPoint}`);
            try {
                // If normal unmount fails, try with sudo (mainly for old /Volumes/ mounts)
                await execPromise(`sudo umount -f "${mountPoint}"`, { timeout: 15000 });
                console.log(`Successfully unmounted with sudo: ${mountPoint}`);
            } catch (sudoError) {
                const errorMessage = sudoError instanceof Error ? sudoError.message : String(sudoError);
                throw new Error(`Failed to unmount SMB share: ${errorMessage}`);
            }
        }
    }
    
    // Clean up the mount point directory
    try {
        await execPromise(`rmdir "${mountPoint}"`);
        console.log(`Cleaned up mount point: ${mountPoint}`);
    } catch (cleanupError) {
        // Only try with sudo if it's an old /Volumes/ mount
        if (mountPoint.startsWith('/Volumes/')) {
            try {
                await execPromise(`sudo rmdir "${mountPoint}"`);
                console.log(`Cleaned up mount point with sudo: ${mountPoint}`);
            } catch (sudoCleanupError) {
                console.warn(`Failed to clean up mount point directory: ${mountPoint}`);
                // Don't throw here as the unmount was successful
            }
        } else {
            console.warn(`Failed to clean up mount point directory: ${mountPoint}`);
            // Don't throw here as the unmount was successful
        }
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
