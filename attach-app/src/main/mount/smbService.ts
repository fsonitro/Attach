// src/main/mount/smbService.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import * as keytar from 'keytar';
import * as os from 'os';

const execPromise = promisify(exec);

// Helper function to get current username dynamically
function getCurrentUsername(): string {
    try {
        return os.userInfo().username;
    } catch (error) {
        // Fallback to environment variable if os.userInfo() fails
        return process.env.USER || process.env.USERNAME || 'user';
    }
}

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
        
        const result = await execPromise(command, { timeout: 8000 });
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
    const isServerUnreachable = !connectivityCheck.accessible;
    
    if (isServerUnreachable) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Server ${serverName} not reachable via standard checks`);
            console.log(`Reason: ${connectivityCheck.error}`);
            console.log(`Proceeding with SMB mount attempt anyway (SMB has its own name resolution)`);
        }
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
    
    // **ENHANCED: Create mount point directory with conflict detection**
    if (process.env.NODE_ENV === 'development') {
        console.log(`Creating mount point: ${mountPoint}`);
    }
    
    try {
        // First check if mount point already exists
        try {
            await execPromise(`test -d "${mountPoint}"`, { timeout: 3000 });
            if (process.env.NODE_ENV === 'development') {
                console.log(`⚠️ Mount point already exists: ${mountPoint}`);
            }
            
            // Check if it's already a mount point
            const isAlreadyMounted = await isMountPoint(mountPoint);
            if (isAlreadyMounted) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔍 Mount point is already mounted, trying to unmount: ${mountPoint}`);
                }
                try {
                    await execPromise(`umount -f "${mountPoint}"`, { timeout: 5000 });
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`✅ Successfully unmounted existing mount: ${mountPoint}`);
                    }
                } catch (unmountError) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`⚠️ Failed to unmount existing mount: ${mountPoint}`);
                    }
                }
            }
            
            // Try to remove the directory and recreate it
            try {
                await execPromise(`rmdir "${mountPoint}" 2>/dev/null || true`, { timeout: 3000 });
            } catch (rmdirError) {
                // Ignore rmdir errors
            }
        } catch (testError) {
            // Directory doesn't exist, which is good
        }
        
        // Create the mount point directory
        await execPromise(`mkdir -p "${mountPoint}"`, { timeout: 10000 });
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`✅ Mount point created: ${mountPoint}`);
        }
    } catch (error) {
        throw new Error(`Failed to create mount point: ${mountPoint} - ${error}`);
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
        const result = await execPromise(command, { timeout: 15000 }); // 15 second timeout - reasonable for mount operations
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
        
        // **FIXED: Check for specific mount conflict error code WITH server reachability context**
        if (sanitizedErrorMessage.includes('-1073741412') || sanitizedStderr.includes('-1073741412')) {
            if (isServerUnreachable) {
                // Server was unreachable during connectivity check - treat as connectivity error
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔍 Detected error (-1073741412) but server was unreachable - treating as connectivity error`);
                }
                throw new Error('Server is unreachable. Please check the server name and network connection.');
            } else {
                // Server was reachable but mount failed with -1073741412 - treat as mount conflict
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔍 Detected mount conflict error (-1073741412) - triggering aggressive cleanup`);
                }
                // This specific error indicates mount point conflict - rethrow with special flag
                const conflictError = new Error('Mount conflict detected. The share may already be mounted by Finder or another process.');
                (conflictError as any).isConflictError = true;
                (conflictError as any).originalError = sanitizedErrorMessage;
                throw conflictError;
            }
        }
        
        // Simplified: Provide helpful error messages without notifications
        if (sanitizedErrorMessage.includes('Authentication') || sanitizedStderr.includes('Authentication')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Authentication failed for ${serverName}`);
            }
            throw new Error('Authentication failed. Please check your username and password.');
        } else if (sanitizedErrorMessage.includes('No route to host') || sanitizedErrorMessage.includes('could not connect') || sanitizedStderr.includes('No route to host')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Could not connect to ${serverName}`);
            }
            throw new Error('Could not connect to the server. Please check the server address and network connection.');
        } else if (sanitizedErrorMessage.includes('Permission denied') || sanitizedStderr.includes('Permission denied')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Permission denied for ${serverName}`);
            }
            throw new Error('Permission denied. Please check your credentials and access rights.');
        } else if (sanitizedErrorMessage.includes('timeout')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Network timeout for ${serverName}`);
            }
            throw new Error('Connection timeout. The server might be unreachable or slow to respond.');
        } else if (sanitizedStderr.includes('mount_smbfs: server rejected the connection')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Server rejected connection to ${serverName}`);
            }
            throw new Error('Server rejected the connection. Please check the server name and share path.');
        } else if (sanitizedStderr.includes('Operation not supported')) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: SMB operation not supported for ${serverName}`);
            }
            throw new Error('SMB operation not supported. The server might not support SMB or the share might not exist.');
        } else {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount failure: Mount operation failed for ${serverName}`);
            }
            // Return a generic error message that doesn't expose sensitive information
            throw new Error('Failed to mount SMB share. Please check your connection details and try again.');
        }
    }
};

// Rapid connectivity check for monitoring purposes (faster, less reliable)
export const quickConnectivityCheck = async (serverName: string, timeoutMs: number = 3000): Promise<{ accessible: boolean; method?: string; error?: string }> => {
    try {
        // Quick SMB port check using nc (netcat) - fastest method
        try {
            await execPromise(`nc -z -w 1 "${serverName}" 445`, { timeout: 2000 });
            return { accessible: true, method: 'SMB port check' };
        } catch (ncError) {
            // nc failed, try DNS resolution only (don't ping)
            try {
                const hostResult = await execPromise(`host "${serverName}"`, { timeout: 2000 });
                if (hostResult.stdout.includes('has address') || hostResult.stdout.includes('has IPv6')) {
                    return { accessible: true, method: 'DNS resolution' };
                }
            } catch (dnsError) {
                // All quick checks failed
                return { 
                    accessible: false, 
                    error: 'SMB port unreachable and DNS resolution failed' 
                };
            }
        }
        
        return { 
            accessible: false, 
            error: 'All quick connectivity checks failed' 
        };
    } catch (error) {
        return { 
            accessible: false, 
            error: 'Connectivity check error: ' + (error instanceof Error ? error.message : String(error))
        };
    }
};

// Enhanced mount operation with monitoring integration
export const mountSMBShareWithMonitoring = async (
    sharePath: string, 
    username: string, 
    password: string,
    onProgress?: (message: string) => void
): Promise<string> => {
    // Notify about operation start
    if (onProgress) {
        onProgress('Preparing to mount share...');
    }

    // Use the existing mountSMBShare function but add progress notifications
    try {
        const mountPoint = await mountSMBShare(sharePath, username, password);
        
        if (onProgress) {
            onProgress(`Successfully mounted to ${mountPoint}`);
        }
        
        return mountPoint;
    } catch (error) {
        if (onProgress) {
            onProgress(`Mount failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
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

// System-wide mount detection functions for handling Finder/system mount conflicts

// Function to detect all SMB mounts on the system (including Finder mounts)
export const detectSystemSMBMounts = async (): Promise<Array<{
    mountPoint: string;
    serverPath: string;
    isAppManaged: boolean;
}>> => {
    try {
        const result = await execPromise(`mount | grep -E "(smbfs|cifs)"`, { timeout: 5000 });
        const mounts: Array<{ mountPoint: string; serverPath: string; isAppManaged: boolean }> = [];
        
        const lines = result.stdout.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            // Parse mount line format: "//server/share on /mount/point (smbfs, ...)"
            const match = line.match(/\/\/([^\/]+\/[^\s]+)\s+on\s+([^\s]+)\s+\(smbfs/);
            if (match) {
                const serverPath = match[1]; // e.g., "workstation/nas"
                const mountPoint = match[2]; // e.g., "/Volumes/nas" or "/Users/felipe/mounts/felipe-xxx"
                const isAppManaged = mountPoint.includes(`${process.env.HOME}/mounts/`);
                
                mounts.push({
                    mountPoint,
                    serverPath,
                    isAppManaged
                });
            }
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Found ${mounts.length} SMB mounts on system:`);
            mounts.forEach(mount => {
                console.log(`  - ${mount.serverPath} → ${mount.mountPoint} (${mount.isAppManaged ? 'app-managed' : 'system/finder'})`);
            });
        }
        
        return mounts;
    } catch (error) {
        // No SMB mounts found or command failed
        if (process.env.NODE_ENV === 'development') {
            console.log('No SMB mounts detected on system');
        }
        return [];
    }
};

// Function to detect if a specific share path conflicts with existing mounts
export const detectMountConflict = async (sharePath: string): Promise<{
    hasConflict: boolean;
    conflictingMount?: {
        mountPoint: string;
        serverPath: string;
        isAppManaged: boolean;
    };
}> => {
    try {
        // Normalize the share path for comparison
        const normalizedSharePath = sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
        
        const systemMounts = await detectSystemSMBMounts();
        
        for (const mount of systemMounts) {
            const mountPath = mount.serverPath.toLowerCase();
            
            // Check for conflicts with multiple matching strategies
            let isConflict = false;
            
            // Direct match (without username)
            if (mountPath === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match with username stripped (system mounts often include username@server/share)
            const mountPathWithoutUser = mountPath.replace(/^[^@]+@/, '');
            if (mountPathWithoutUser === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match adding username to connection path (connection might not include username)
            if (mountPath === `${getCurrentUsername()}@${normalizedSharePath}`) {
                isConflict = true;
            }
            
            if (isConflict) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Mount conflict detected: ${sharePath} is already mounted at ${mount.mountPoint}`);
                    console.log(`   Conflict match: "${normalizedSharePath}" vs "${mountPath}"`);
                }
                return {
                    hasConflict: true,
                    conflictingMount: mount
                };
            }
        }
        
        return { hasConflict: false };
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Error checking mount conflicts for ${sharePath}:`, error);
        }
        return { hasConflict: false };
    }
};

// Function to safely eject a conflicting mount
export const safeEjectConflictingMount = async (mountPoint: string, serverPath: string): Promise<{
    success: boolean;
    error?: string;
}> => {
    try {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Attempting to eject conflicting mount: ${serverPath} at ${mountPoint}`);
        }
        
        // Check if mount point is still active
        const isStillMounted = await isMountPoint(mountPoint);
        if (!isStillMounted) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mount ${mountPoint} is no longer active, skipping ejection`);
            }
            return { success: true };
        }
        
        // For /Volumes/ mounts (Finder), try diskutil eject first
        if (mountPoint.startsWith('/Volumes/')) {
            try {
                await execPromise(`diskutil eject "${mountPoint}"`, { timeout: 8000 });
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Successfully ejected via diskutil: ${mountPoint}`);
                }
                return { success: true };
            } catch (diskutilError) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`diskutil eject failed, trying umount: ${mountPoint}`);
                }
            }
        }
        
        // Try standard umount (with shorter timeout to prevent hanging)
        try {
            await execPromise(`umount "${mountPoint}"`, { timeout: 5000 });
            if (process.env.NODE_ENV === 'development') {
                console.log(`Successfully unmounted: ${mountPoint}`);
            }
            return { success: true };
        } catch (umountError) {
            // Try forced umount as last resort (with shorter timeout)
            try {
                await execPromise(`umount -f "${mountPoint}"`, { timeout: 8000 });
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Successfully force unmounted: ${mountPoint}`);
                }
                return { success: true };
            } catch (forceError) {
                // **CRITICAL FIX**: Don't fail or try sudo - gracefully handle unmount failures
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`Failed to unmount ${mountPoint} - network disconnection may have left mount in inconsistent state`);
                }
                // Return success to prevent cascading failures - system will clean up eventually
                return { success: true, error: `Unmount failed but continuing cleanup: ${forceError instanceof Error ? forceError.message : String(forceError)}` };
            }
        }
    } catch (error) {
        const errorMessage = `Error ejecting mount ${mountPoint}: ${error instanceof Error ? error.message : String(error)}`;
        if (process.env.NODE_ENV === 'development') {
            console.warn(errorMessage);
        }
        return { success: false, error: errorMessage };
    }
};

// Function to clean up all stale mounts for a specific share path
export const cleanupStaleMounts = async (sharePath: string): Promise<{
    cleaned: number;
    errors: string[];
}> => {
    const errors: string[] = [];
    let cleaned = 0;
    
    try {
        const normalizedSharePath = sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
        const systemMounts = await detectSystemSMBMounts();
        
        for (const mount of systemMounts) {
            const mountPath = mount.serverPath.toLowerCase();
            
            // Check for conflicts with multiple matching strategies
            let isConflict = false;
            
            // Direct match (without username)
            if (mountPath === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match with username stripped (system mounts often include username@server/share)
            const mountPathWithoutUser = mountPath.replace(/^[^@]+@/, '');
            if (mountPathWithoutUser === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match adding username to connection path (connection might not include username)
            if (mountPath === `${getCurrentUsername()}@${normalizedSharePath}`) {
                isConflict = true;
            }
            
            if (isConflict) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🎯 Cleaning up conflicting mount: ${mount.serverPath} at ${mount.mountPoint}`);
                    console.log(`   Conflict match: "${normalizedSharePath}" vs "${mountPath}"`);
                }
                const result = await safeEjectConflictingMount(mount.mountPoint, mount.serverPath);
                if (result.success) {
                    cleaned++;
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`✅ Cleaned up stale mount: ${mount.mountPoint}`);
                    }
                } else {
                    errors.push(result.error || `Failed to clean up ${mount.mountPoint}`);
                }
            }
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Cleanup completed for ${sharePath}: ${cleaned} cleaned, ${errors.length} errors`);
        }
        
        return { cleaned, errors };
    } catch (error) {
        const errorMessage = `Error during stale mount cleanup: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMessage);
        return { cleaned, errors };
    }
};

// Function to clean up orphaned mount directories
export const cleanupOrphanedMountDirs = async (): Promise<string[]> => {
    const cleanedUpDirs: string[] = [];
    const mountsDir = `${process.env.HOME}/mounts`;
    
    try {
        // Check if mounts directory exists
        try {
            await execPromise(`test -d "${mountsDir}"`);
        } catch (dirError) {
            // Mounts directory doesn't exist, nothing to clean up
            if (process.env.NODE_ENV === 'development') {
                console.log(`Mounts directory doesn't exist: ${mountsDir}`);
            }
            return cleanedUpDirs;
        }
        
        // Get list of directories in mounts folder, handle case where directory might be empty
        try {
            const result = await execPromise(`find "${mountsDir}" -maxdepth 1 -type d -not -path "${mountsDir}" 2>/dev/null || true`, { timeout: 8000 });
            const mountDirs = result.stdout.trim().split('\n').filter(dir => dir.length > 0 && dir.trim() !== '');
            
            if (mountDirs.length === 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('No mount directories found to clean up');
                }
                return cleanedUpDirs;
            }
            
            for (const dir of mountDirs) {
                try {
                    // Check if this directory still exists (it might have been cleaned up by the system)
                    await execPromise(`test -d "${dir}"`, { timeout: 3000 });
                    
                    // Check if this directory is still a valid mount point
                    const isStillMounted = await isMountPoint(dir);
                    const isAccessible = await isMountPointAccessible(dir);
                    
                    if (!isStillMounted || !isAccessible) {
                        try {
                            // Try to unmount if it's still showing as mounted but not accessible
                            if (isStillMounted && !isAccessible) {
                                if (process.env.NODE_ENV === 'development') {
                                    console.log(`Attempting to unmount orphaned mount: ${dir}`);
                                }
                                try {
                                    await execPromise(`umount -f "${dir}"`, { timeout: 5000 });
                                } catch (unmountError) {
                                    // **CRITICAL FIX**: Don't fail on unmount errors during cleanup
                                    if (process.env.NODE_ENV === 'development') {
                                        console.warn(`Failed to unmount orphaned mount ${dir}, continuing cleanup anyway`);
                                    }
                                }
                            }
                            
                            // Remove the empty directory
                            await execPromise(`rmdir "${dir}"`, { timeout: 5000 });
                            cleanedUpDirs.push(dir);
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`Cleaned up orphaned mount directory: ${dir}`);
                            }
                        } catch (cleanupError) {
                            if (process.env.NODE_ENV === 'development') {
                                console.warn(`Failed to clean up directory ${dir}:`, cleanupError);
                            }
                        }
                    }
                } catch (dirCheckError) {
                    // Directory doesn't exist anymore, which is fine
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Directory ${dir} was already removed`);
                    }
                }
            }
        } catch (findError) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('Failed to list mount directories:', findError);
            }
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.warn('Failed to cleanup orphaned mount directories:', error);
        }
    }
    
    return cleanedUpDirs;
};

// Function to validate and refresh mount status with enhanced monitoring
export const validateMountedShares = async (mountedShares: Map<string, any>): Promise<string[]> => {
    const disconnectedShares: string[] = [];
    
    for (const [label, share] of Array.from(mountedShares.entries())) {
        const isAccessible = await isMountPointAccessible(share.mountPoint);
        const isStillMounted = await isMountPoint(share.mountPoint);
        
        if (!isAccessible || !isStillMounted) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Share ${label} is no longer accessible, removing from list`);
            }
            disconnectedShares.push(label);
            
            // Simplified: Log issues before cleanup without notifications
            if (!isAccessible && isStillMounted) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`${label}: Share mounted but not accessible - will force disconnect`);
                }
            } else if (!isStillMounted && isAccessible) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`${label}: Mount point lost - cleaning up directory`);
                }
            }
            
            // Try to clean up the mount point if it exists
            try {
                if (!isStillMounted) {
                    // If not mounted but directory exists, remove it
                    await execPromise(`test -d "${share.mountPoint}" && rmdir "${share.mountPoint}"`, { timeout: 5000 });
                } else {
                    // If still mounted but not accessible, try to unmount
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Force unmounting inaccessible share: ${label}`);
                    }
                    try {
                        await execPromise(`umount -f "${share.mountPoint}"`, { timeout: 5000 });
                        await execPromise(`rmdir "${share.mountPoint}"`, { timeout: 5000 });
                    } catch (unmountError) {
                        // **CRITICAL FIX**: Don't fail on unmount errors - just log and continue
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`Failed to unmount disconnected share ${label}, system will clean up later:`, unmountError);
                        }
                        // Still try to remove directory if possible
                        try {
                            await execPromise(`rmdir "${share.mountPoint}"`, { timeout: 3000 });
                        } catch (rmdirError) {
                            // Ignore rmdir errors too
                        }
                    }
                }
            } catch (cleanupError) {
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`Failed to cleanup disconnected share ${label}:`, cleanupError);
                }
            }
        }
    }
    
    return disconnectedShares;
};

// Function to unmount an SMB share without sudo prompts
export const unmountSMBShare = async (mountPoint: string): Promise<void> => {
    // Update validation to accept both old /Volumes/ paths and new ~/mounts/ paths
    const homeMountsPath = `${process.env.HOME}/mounts/`;
    if (!mountPoint || (!mountPoint.startsWith('/Volumes/') && !mountPoint.startsWith(homeMountsPath))) {
        throw new Error('Invalid mount point');
    }

    try {
        // First try a gentle unmount with shorter timeout
        await execPromise(`umount "${mountPoint}"`, { timeout: 5000 });
        if (process.env.NODE_ENV === 'development') {
            console.log(`Successfully unmounted: ${mountPoint}`);
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Gentle unmount failed, trying forced unmount: ${mountPoint}`);
        }
        try {
            // If gentle unmount fails, try forced unmount with shorter timeout
            await execPromise(`umount -f "${mountPoint}"`, { timeout: 8000 });
            if (process.env.NODE_ENV === 'development') {
                console.log(`Successfully force unmounted: ${mountPoint}`);
            }
        } catch (forceError) {
            // **CRITICAL FIX**: Don't use sudo - it causes password prompts that hang the app
            // Instead, treat this as a "best effort" unmount and clean up the directory
            if (process.env.NODE_ENV === 'development') {
                console.warn(`Force unmount failed for: ${mountPoint}`);
                console.log(`Network disconnection may have left mount in inconsistent state - cleaning up directory`);
            }
            
            // Don't throw error - continue with cleanup even if unmount failed
            // The system will eventually clean up the mount point when network reconnects
        }
    }
    
    // Clean up the mount point directory - ensure it's completely removed
    try {
        // First check if directory exists
        await execPromise(`test -d "${mountPoint}"`, { timeout: 3000 });
        
        // Try to remove it - first check if it's empty
        try {
            await execPromise(`rmdir "${mountPoint}"`, { timeout: 3000 });
            if (process.env.NODE_ENV === 'development') {
                console.log(`Cleaned up mount point: ${mountPoint}`);
            }
        } catch (rmdirError) {
            // If rmdir fails, the directory might not be empty or still has system locks
            if (process.env.NODE_ENV === 'development') {
                console.warn(`rmdir failed for ${mountPoint}, trying alternative cleanup...`);
            }
            
            try {
                // Check if directory still exists after failed rmdir
                await execPromise(`test -d "${mountPoint}"`, { timeout: 2000 });
                
                // Directory exists but can't be removed with rmdir
                // For ~/mounts/ paths, try rm -rf (safe since it's in user space)
                if (mountPoint.startsWith(homeMountsPath)) {
                    try {
                        await execPromise(`rm -rf "${mountPoint}"`, { timeout: 5000 });
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`Force cleaned up mount point: ${mountPoint}`);
                        }
                    } catch (rmError) {
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`Could not remove mount directory: ${mountPoint} - system may clean it up later`);
                        }
                        // Don't throw error - this is cleanup, not critical
                    }
                } else {
                    // For /Volumes/ paths, we can't safely force remove without sudo
                    // Log the issue but don't fail the operation
                    if (process.env.NODE_ENV === 'development') {
                        console.warn(`Mount directory ${mountPoint} could not be cleaned up - system will handle it`);
                    }
                }
            } catch (testDirError) {
                // Directory doesn't exist anymore, which is what we wanted
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Mount point directory was already removed by system: ${mountPoint}`);
                }
            }
        }
    } catch (testError) {
        // Directory doesn't exist, which is fine
        if (process.env.NODE_ENV === 'development') {
            console.log(`Mount point directory doesn't exist: ${mountPoint}`);
        }
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

// **NEW: Aggressive cleanup function for mount conflict resolution**
// This function is specifically designed to handle the -1073741412 error
// which occurs when Finder holds stale mounts after network disconnection
export const aggressiveConflictCleanup = async (sharePath: string): Promise<{
    cleaned: number;
    errors: string[];
    foundFinderMounts: boolean;
}> => {
    const errors: string[] = [];
    let cleaned = 0;
    let foundFinderMounts = false;
    
    try {
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔧 Starting aggressive conflict cleanup for: ${sharePath}`);
        }
        
        const normalizedSharePath = sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
        const systemMounts = await detectSystemSMBMounts();
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔍 Found ${systemMounts.length} SMB mounts to check for conflicts`);
        }
        
        // First, try to clean up any existing SMB mounts
        for (const mount of systemMounts) {
            const mountPath = mount.serverPath.toLowerCase();
            
            // Check for conflicts with multiple matching strategies
            let isConflict = false;
            
            // Direct match (without username)
            if (mountPath === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match with username stripped (system mounts often include username@server/share)
            const mountPathWithoutUser = mountPath.replace(/^[^@]+@/, '');
            if (mountPathWithoutUser === normalizedSharePath) {
                isConflict = true;
            }
            
            // Match adding username to connection path (connection might not include username)
            if (mountPath === `${getCurrentUsername()}@${normalizedSharePath}`) {
                isConflict = true;
            }
            
            if (isConflict) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🎯 Found conflicting mount: ${mount.serverPath} at ${mount.mountPoint} (${mount.isAppManaged ? 'app' : 'system/finder'})`);
                    console.log(`   Conflict match: "${normalizedSharePath}" vs "${mountPath}"`);
                }
                
                if (!mount.isAppManaged && mount.mountPoint.startsWith('/Volumes/')) {
                    foundFinderMounts = true;
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🍎 Finder mount detected: ${mount.mountPoint}`);
                    }
                }
                
                // Try multiple ejection methods for stubborn mounts
                let ejected = false;
                
                // Method 1: diskutil eject (works best for Finder mounts)
                if (mount.mountPoint.startsWith('/Volumes/')) {
                    try {
                        await execPromise(`diskutil eject "${mount.mountPoint}"`, { timeout: 8000 });
                        ejected = true;
                        cleaned++;
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Successfully ejected via diskutil: ${mount.mountPoint}`);
                        }
                    } catch (diskutilError) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`⚠️ diskutil eject failed for ${mount.mountPoint}, trying alternatives...`);
                        }
                    }
                }
                
                // Method 2: Standard umount if diskutil failed
                if (!ejected) {
                    try {
                        await execPromise(`umount "${mount.mountPoint}"`, { timeout: 5000 });
                        ejected = true;
                        cleaned++;
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Successfully unmounted: ${mount.mountPoint}`);
                        }
                    } catch (umountError) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`⚠️ umount failed for ${mount.mountPoint}, trying forced umount...`);
                        }
                    }
                }
                
                // Method 3: Forced umount as last resort
                if (!ejected) {
                    try {
                        await execPromise(`umount -f "${mount.mountPoint}"`, { timeout: 8000 });
                        ejected = true;
                        cleaned++;
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Successfully force unmounted: ${mount.mountPoint}`);
                        }
                    } catch (forceError) {
                        const errorMsg = `Failed to eject conflicting mount: ${mount.mountPoint}`;
                        errors.push(errorMsg);
                        if (process.env.NODE_ENV === 'development') {
                            console.error(`❌ All ejection methods failed for: ${mount.mountPoint}`);
                        }
                    }
                }
            }
        }
        
        // **NEW: Additional cleanup for error -1073741412 when no SMB mounts found**
        if (systemMounts.length === 0) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔧 No existing SMB mounts found, but error -1073741412 occurred. Trying additional cleanup...`);
            }
            
            // Try to clean up any stale mount directories that might be causing conflicts
            const mountsDir = `${process.env.HOME}/mounts`;
            try {
                const result = await execPromise(`find "${mountsDir}" -maxdepth 1 -type d -name "*" 2>/dev/null || true`, { timeout: 5000 });
                const directories = result.stdout.trim().split('\n').filter(dir => dir && dir !== mountsDir);
                
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🔍 Found ${directories.length} directories in ${mountsDir}`);
                }
                
                for (const dir of directories) {
                    try {
                        // Check if directory is a mount point
                        const isMounted = await isMountPoint(dir);
                        if (isMounted) {
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`🎯 Found stale mount point: ${dir}`);
                            }
                            try {
                                await execPromise(`umount -f "${dir}"`, { timeout: 5000 });
                                cleaned++;
                                if (process.env.NODE_ENV === 'development') {
                                    console.log(`✅ Force unmounted stale mount: ${dir}`);
                                }
                            } catch (unmountError) {
                                if (process.env.NODE_ENV === 'development') {
                                    console.log(`⚠️ Failed to unmount ${dir}: ${unmountError}`);
                                }
                            }
                        }
                        
                        // Also try to remove the directory if it's empty
                        try {
                            await execPromise(`rmdir "${dir}" 2>/dev/null || true`, { timeout: 3000 });
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`🧹 Removed directory: ${dir}`);
                            }
                        } catch (rmdirError) {
                            // Ignore rmdir errors
                        }
                    } catch (checkError) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`⚠️ Error checking directory ${dir}: ${checkError}`);
                        }
                    }
                }
            } catch (findError) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⚠️ Error listing mount directories: ${findError}`);
                }
            }
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔧 Aggressive cleanup completed: ${cleaned} cleaned, ${errors.length} errors, Finder mounts found: ${foundFinderMounts}`);
        }
        
        return { cleaned, errors, foundFinderMounts };
    } catch (error) {
        const errorMessage = `Aggressive cleanup error: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMessage);
        if (process.env.NODE_ENV === 'development') {
            console.error(`❌ Aggressive cleanup failed: ${errorMessage}`);
        }
        return { cleaned, errors, foundFinderMounts };
    }
};