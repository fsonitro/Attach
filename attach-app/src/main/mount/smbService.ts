// src/main/mount/smbService.ts

import { exec } from 'child_process';
import { promisify } from 'util';
<<<<<<< HEAD
import * as keytar from 'keytar';
import { 
    networkNotifications, 
    notifyServerUnreachable, 
    notifyMountFailure,
    notifyNetworkTimeout 
} from '../utils/networkNotifications';
=======
import keytar from 'keytar';
>>>>>>> parent of d074622 (Added network resilience)

const execPromise = promisify(exec);

// Function to list available shares on a server (for validation and case correction)
export const listSMBShares = async (serverName: string, username?: string, password?: string): Promise<string[]> => {
    try {
        let command: string;
        
        if (username && password) {
            // Use authenticated connection with password piped via stdin
            const escapedPassword = "'" + password.replace(/'/g, "'\"'\"'") + "'";
            command = `echo ${escapedPassword} | smbutil view "//${username}@${serverName}" -`;
            if (process.env.NODE_ENV === 'development') {
                console.log(`Listing shares on ${serverName} with authentication for user: ${username}`);
            }
        } else {
            // Try without authentication first (for public shares)
            command = `smbutil view "//${serverName}"`;
            if (process.env.NODE_ENV === 'development') {
                console.log(`Listing shares on ${serverName} without authentication`);
            }
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
        // Only log detailed errors in development
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Failed to list shares for ${serverName} (user: ${username || 'anonymous'}):`, 'Authentication or connection error');
        }
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
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Found case-corrected share: ${shareName} -> ${share}`);
                }
                return share;
            }
        }
        
        // If no match found, return original name
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Share ${shareName} not found in available shares:`, availableShares);
        }
        return shareName;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Failed to find correct case for share ${shareName} on ${serverName}:`, 'Connection or authentication error');
        }
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
    
    // Pre-mount connectivity check to prevent hanging (non-blocking)
    if (process.env.NODE_ENV === 'development') {
        console.log(`Checking connectivity to server: ${serverName}`);
    }
    
    const connectivityCheck = await checkServerConnectivity(serverName, 5000);
    if (!connectivityCheck.accessible) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Server ${serverName} not reachable via ping/DNS, but attempting SMB connection anyway`);
            console.log(`Reason: ${connectivityCheck.error}`);
        }
        // Don't block the mount - SMB has its own name resolution mechanisms
        // Just log the issue for debugging
    } else {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Server ${serverName} is reachable, proceeding with mount`);
        }
    }
    
    // Try to find the correct case for the share name
    if (process.env.NODE_ENV === 'development') {
        console.log(`Looking for share: ${originalShareName} on server: ${serverName}`);
    }
    // For now, just try the common case variations to avoid interactive prompts
    let correctedShareName = originalShareName;
    if (originalShareName.toLowerCase() === 'nas') {
        correctedShareName = 'NAS'; // Common case for NAS shares
        if (process.env.NODE_ENV === 'development') {
            console.log(`Applied common case correction: ${originalShareName} -> ${correctedShareName}`);
        }
    }
    // In the future, we could add more case corrections here or implement the authenticated lookup
    // const correctedShareName = await findCorrectShareCase(serverName, originalShareName, sanitizedUsername, password);
    
    // Reconstruct the path with corrected case
    sanitizedSharePath = `${serverName}/${correctedShareName}`;
    
    const mountLabel = `${sanitizedUsername}-${Date.now()}`;
    // Use user's home directory instead of /Volumes/ to avoid sudo requirements
    const mountPoint = `${process.env.HOME}/mounts/${mountLabel}`;
    
    // Create mount point directory (no sudo needed in user's home)
    if (process.env.NODE_ENV === 'development') {
        console.log(`Creating mount point: ${mountPoint}`);
    }
    try {
        await execPromise(`mkdir -p "${mountPoint}"`, { timeout: 30000 });
    } catch (error) {
        throw new Error(`Failed to create mount point: ${mountPoint}`);
    }
    
    // Build the mount command with proper URL encoding for special characters
    // URL encode the password to handle special characters like $, {, }, =, ~, etc.
    const encodedPassword = encodeURIComponent(password);
    const command = `mount_smbfs "smb://${sanitizedUsername}:${encodedPassword}@${sanitizedSharePath}" "${mountPoint}"`;

    if (process.env.NODE_ENV === 'development') {
        console.log(`Attempting to mount: //${sanitizedSharePath} as user: ${sanitizedUsername}`);
        console.log(`Mount command: mount_smbfs "smb://${sanitizedUsername}:[HIDDEN]@${sanitizedSharePath}" "${mountPoint}"`);
    }

    try {
        const result = await execPromise(command, { timeout: 60000 }); // 60 second timeout
        if (process.env.NODE_ENV === 'development') {
            console.log(`Mount successful: //${sanitizedSharePath} -> ${mountPoint}`);
            if (result.stdout && result.stdout.trim().length > 0) {
                console.log(`Mount result stdout:`, result.stdout);
            }
        }
        
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
            if (process.env.NODE_ENV === 'development') {
                console.warn(`Failed to clean up mount point: ${mountPoint}`);
            }
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stderr = (error as any).stderr || '';
        
        // Sanitize error messages to remove any potential password exposure
        const sanitizedErrorMessage = errorMessage.replace(new RegExp(encodeURIComponent(password), 'g'), '[HIDDEN]');
        const sanitizedStderr = stderr.replace(new RegExp(encodeURIComponent(password), 'g'), '[HIDDEN]');
        
        // Log sanitized error for debugging (only in development)
        if (process.env.NODE_ENV === 'development') {
            console.error(`Mount failed for share: //${sanitizedSharePath} user: ${sanitizedUsername}`);
            console.error(`Sanitized error:`, sanitizedErrorMessage);
            if (sanitizedStderr) {
                console.error(`Sanitized stderr:`, sanitizedStderr);
            }
        }
        
        // Provide more helpful error messages (without exposing sensitive data)
        if (sanitizedErrorMessage.includes('Authentication') || sanitizedStderr.includes('Authentication')) {
            await notifyMountFailure(serverName, 'Authentication failed');
            throw new Error('Authentication failed. Please check your username and password.');
        } else if (sanitizedErrorMessage.includes('No route to host') || sanitizedErrorMessage.includes('could not connect') || sanitizedStderr.includes('No route to host')) {
            await notifyMountFailure(serverName, 'Could not connect to server');
            throw new Error('Could not connect to the server. Please check the server address and network connection.');
        } else if (sanitizedErrorMessage.includes('Permission denied') || sanitizedStderr.includes('Permission denied')) {
            await notifyMountFailure(serverName, 'Permission denied');
            throw new Error('Permission denied. Please check your credentials and access rights.');
        } else if (sanitizedErrorMessage.includes('timeout')) {
            await notifyNetworkTimeout('SMB mount operation');
            throw new Error('Connection timeout. The server might be unreachable or slow to respond.');
        } else if (sanitizedStderr.includes('mount_smbfs: server rejected the connection')) {
            await notifyMountFailure(serverName, 'Server rejected connection');
            throw new Error('Server rejected the connection. Please check the server name and share path.');
        } else if (sanitizedStderr.includes('Operation not supported')) {
            await notifyMountFailure(serverName, 'SMB operation not supported');
            throw new Error('SMB operation not supported. The server might not support SMB or the share might not exist.');
        } else {
            await notifyMountFailure(serverName, 'Mount operation failed');
            // Return a generic error message that doesn't expose sensitive information
            throw new Error('Failed to mount SMB share. Please check your connection details and try again.');
        }
    }
};

// Function to check if a mount point is still accessible/mounted
export const isMountPointAccessible = async (mountPoint: string): Promise<boolean> => {
    try {
        // Check if the mount point exists and is accessible
        await execPromise(`test -d "${mountPoint}" && ls "${mountPoint}" > /dev/null 2>&1`, { timeout: 5000 });
        return true;
    } catch (error) {
        // Mount point not accessible (only log in development)
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Mount point not accessible: ${mountPoint}`);
        }
        return false;
    }
};

// Function to check if a directory is actually a mount point (not just a regular directory)
export const isMountPoint = async (path: string): Promise<boolean> => {
    try {
        // Use mount command to check if this path is a mount point
        const result = await execPromise(`mount | grep "${path}"`, { timeout: 5000 });
        return result.stdout.trim().length > 0;
    } catch (error) {
        return false;
    }
};

// Function to clean up orphaned mount directories
export const cleanupOrphanedMountDirs = async (): Promise<string[]> => {
    const cleanedUpDirs: string[] = [];
    const mountsDir = `${process.env.HOME}/mounts`;
    
    try {
        // Check if mounts directory exists
        await execPromise(`test -d "${mountsDir}"`);
        
        // Get list of directories in mounts folder
        const result = await execPromise(`find "${mountsDir}" -maxdepth 1 -type d -not -path "${mountsDir}"`, { timeout: 10000 });
        const mountDirs = result.stdout.trim().split('\n').filter(dir => dir.length > 0);
        
        for (const dir of mountDirs) {
            // Check if this directory is still a valid mount point
            const isStillMounted = await isMountPoint(dir);
            const isAccessible = await isMountPointAccessible(dir);
            
            if (!isStillMounted || !isAccessible) {
                try {
                    // Try to unmount if it's still showing as mounted but not accessible
                    if (isStillMounted && !isAccessible) {
                        console.log(`Attempting to unmount orphaned mount: ${dir}`);
                        await execPromise(`umount -f "${dir}"`, { timeout: 10000 });
                    }
                    
                    // Remove the empty directory
                    await execPromise(`rmdir "${dir}"`, { timeout: 5000 });
                    cleanedUpDirs.push(dir);
                    console.log(`Cleaned up orphaned mount directory: ${dir}`);
                } catch (cleanupError) {
                    console.warn(`Failed to clean up directory ${dir}:`, cleanupError);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to cleanup orphaned mount directories:', error);
    }
    
    return cleanedUpDirs;
};

// Function to validate and refresh mount status
export const validateMountedShares = async (mountedShares: Map<string, any>): Promise<string[]> => {
    const disconnectedShares: string[] = [];
    
    for (const [label, share] of Array.from(mountedShares.entries())) {
        const isAccessible = await isMountPointAccessible(share.mountPoint);
        const isStillMounted = await isMountPoint(share.mountPoint);
        
        if (!isAccessible || !isStillMounted) {
            console.log(`Share ${label} is no longer accessible, removing from list`);
            disconnectedShares.push(label);
            
            // Try to clean up the mount point if it exists
            try {
                if (!isStillMounted) {
                    // If not mounted but directory exists, remove it
                    await execPromise(`test -d "${share.mountPoint}" && rmdir "${share.mountPoint}"`, { timeout: 5000 });
                } else {
                    // If still mounted but not accessible, try to unmount
                    await execPromise(`umount -f "${share.mountPoint}"`, { timeout: 10000 });
                    await execPromise(`rmdir "${share.mountPoint}"`, { timeout: 5000 });
                }
            } catch (cleanupError) {
                console.warn(`Failed to cleanup disconnected share ${label}:`, cleanupError);
            }
        }
    }
    
    return disconnectedShares;
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
    
    // Clean up the mount point directory - ensure it's completely removed
    try {
        // First check if directory exists and is empty
        await execPromise(`test -d "${mountPoint}"`, { timeout: 5000 });
        
        // Try to remove it - first check if it's empty
        try {
            await execPromise(`rmdir "${mountPoint}"`, { timeout: 5000 });
            console.log(`Cleaned up mount point: ${mountPoint}`);
        } catch (rmdirError) {
            // If rmdir fails, the directory might not be empty, try a more forceful approach
            console.warn(`rmdir failed, checking directory contents: ${mountPoint}`);
            try {
                const contents = await execPromise(`ls -la "${mountPoint}"`, { timeout: 5000 });
                console.log(`Directory contents:`, contents.stdout);
                
                // If directory is not empty, something is wrong, but we'll try to remove it anyway
                if (mountPoint.startsWith('/Volumes/')) {
                    await execPromise(`sudo rm -rf "${mountPoint}"`, { timeout: 10000 });
                } else {
                    await execPromise(`rm -rf "${mountPoint}"`, { timeout: 10000 });
                }
                console.log(`Force cleaned up mount point: ${mountPoint}`);
            } catch (forceCleanupError) {
                console.warn(`Failed to force cleanup mount point: ${mountPoint}`, forceCleanupError);
            }
        }
    } catch (testError) {
        // Directory doesn't exist, which is fine
        console.log(`Mount point directory already removed: ${mountPoint}`);
    }
};

// Legacy functions - kept for backwards compatibility
// Function to store credentials securely
export const storeCredentials = async (service: string, username: string, password: string): Promise<void> => {
    await keytar.setPassword(service, username, password);
};

// Function to retrieve stored credentials
export const getStoredCredentials = async (service: string, username: string): Promise<string | null> => {
    return await keytar.getPassword(service, username);
};

// Pre-mount connectivity check to prevent hanging (improved for SMB)
export const checkServerConnectivity = async (serverName: string, timeoutMs: number = 5000): Promise<{ accessible: boolean; error?: string }> => {
    try {
        // First, try to check SMB port (445) connectivity using nc (netcat)
        try {
            const ncResult = await execPromise(`nc -z -w 3 "${serverName}" 445`, { timeout: 5000 });
            if (ncResult.stdout === '' && !ncResult.stderr) {
                // nc exits cleanly when port is open
                return { accessible: true };
            }
        } catch (ncError) {
            // nc might not be available or connection failed, continue with other checks
        }

        // Second, try a simple ping to check if the server is reachable
        try {
            const pingResult = await execPromise(`ping -c 1 -W ${Math.floor(timeoutMs / 1000)} "${serverName}"`, { timeout: timeoutMs });
            
            if (pingResult.stdout.includes('1 packets transmitted, 1 received')) {
                return { accessible: true };
            }
        } catch (pingError) {
            // Ping failed, but this doesn't mean SMB won't work
        }

        // Third, try hostname resolution
        try {
            const hostResult = await execPromise(`host "${serverName}"`, { timeout: 3000 });
            if (hostResult.stdout.includes('has address') || hostResult.stdout.includes('has IPv6')) {
                // Host resolves but might not be pingable (common with Windows machines)
                return { accessible: true };
            }
        } catch (hostError) {
            // All basic checks failed
        }
        
        // If all checks fail, it might still work via NetBIOS/SMB discovery
        return { 
            accessible: false, 
            error: 'Standard connectivity checks failed, but SMB connection may still work via NetBIOS discovery' 
        };
    } catch (error) {
        return { 
            accessible: false, 
            error: 'Unable to verify server connectivity. SMB connection may still work.' 
        };
    }
};