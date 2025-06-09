// This file provides functions to interact with the filesystem, such as reading directory contents and managing mounted shares.

import { promises as fs, Stats } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { 
    networkNotifications, 
    notifyNetworkTimeout, 
    notifyShareInaccessible 
} from '../utils/networkNotifications';

const execPromise = promisify(exec);

// Timeout wrapper for filesystem operations to prevent hanging on network issues
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number = 5000, operationName: string = 'filesystem operation'): Promise<T> {
    return Promise.race([
        operation,
        new Promise<never>((_, reject) => 
            setTimeout(async () => {
                // Notify user about timeout before rejecting
                await notifyNetworkTimeout(operationName);
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs)
        )
    ]);
}

// Check if a path is accessible without hanging
export async function isPathAccessible(dirPath: string): Promise<boolean> {
    try {
        await withTimeout(fs.access(dirPath), 3000, 'path accessibility check');
        return true;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(`Path not accessible: ${dirPath}`, error);
        }
        return false;
    }
}

// Check if a path is a network mount point
export async function isNetworkMount(mountPath: string): Promise<boolean> {
    try {
        const result = await execPromise(`mount | grep "${mountPath}"`, { timeout: 3000 });
        return result.stdout.includes('smbfs') || result.stdout.includes('cifs') || result.stdout.includes('nfs');
    } catch (error) {
        return false;
    }
}

// Pre-operation connectivity check for network mounts
export async function checkNetworkConnectivity(mountPath: string): Promise<{ accessible: boolean; isNetwork: boolean; error?: string }> {
    try {
        const isNetwork = await isNetworkMount(mountPath);
        
        if (!isNetwork) {
            // For local paths, just check if accessible
            const accessible = await isPathAccessible(mountPath);
            return { accessible, isNetwork: false };
        }
        
        // For network mounts, do a more thorough check
        const accessible = await withTimeout(
            Promise.all([
                fs.access(mountPath),
                fs.readdir(mountPath).then(() => true).catch(() => false)
            ]).then(([, canRead]) => canRead),
            5000,
            'network mount connectivity check'
        );
        
        return { accessible, isNetwork: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timeout')) {
            await notifyNetworkTimeout('Network mount connectivity check');
        } else {
            await notifyShareInaccessible(path.basename(mountPath));
        }
        return { 
            accessible: false, 
            isNetwork: await isNetworkMount(mountPath), 
            error: errorMessage 
        };
    }
}

export async function readDirectoryContents(dirPath: string): Promise<string[]> {
    try {
        // First check connectivity for network mounts
        const connectivity = await checkNetworkConnectivity(dirPath);
        
        if (!connectivity.accessible) {
            const errorMsg = connectivity.isNetwork 
                ? `Network share is not accessible: ${connectivity.error || 'Connection lost'}`
                : `Directory is not accessible: ${dirPath}`;
            
            // Notify user if it's a network mount issue
            if (connectivity.isNetwork) {
                await notifyShareInaccessible(path.basename(dirPath));
            }
            
            throw new Error(errorMsg);
        }
        
        // Use timeout wrapper to prevent hanging
        const files = await withTimeout(
            fs.readdir(dirPath),
            connectivity.isNetwork ? 10000 : 5000, // Longer timeout for network mounts
            'directory read operation'
        );
        
        return files;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        throw error;
    }
}

export async function getFileStats(filePath: string): Promise<Stats> {
    try {
        // Check if the parent directory is accessible first
        const parentDir = path.dirname(filePath);
        const connectivity = await checkNetworkConnectivity(parentDir);
        
        if (!connectivity.accessible) {
            const errorMsg = connectivity.isNetwork 
                ? `Network share is not accessible for file stats: ${connectivity.error || 'Connection lost'}`
                : `Parent directory is not accessible: ${parentDir}`;
            
            // Notify user if it's a network mount issue
            if (connectivity.isNetwork) {
                await notifyShareInaccessible(path.basename(parentDir));
            }
            
            throw new Error(errorMsg);
        }
        
        // Use timeout wrapper to prevent hanging
        const stats = await withTimeout(
            fs.stat(filePath),
            connectivity.isNetwork ? 8000 : 4000, // Longer timeout for network mounts
            'file stats operation'
        );
        
        return stats;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error getting stats for file ${filePath}:`, error);
        }
        throw error;
    }
}

// Safe file/folder opening with network connectivity checks
export async function safeOpenPath(folderPath: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Check connectivity before attempting to open
        const connectivity = await checkNetworkConnectivity(folderPath);
        
        if (!connectivity.accessible) {
            const errorMsg = connectivity.isNetwork 
                ? `Cannot open network share: ${connectivity.error || 'Network connection lost'}`
                : `Cannot access path: ${folderPath}`;
            
            // Notify user if it's a network mount issue
            if (connectivity.isNetwork) {
                await notifyShareInaccessible(path.basename(folderPath));
            }
            
            return { success: false, error: errorMsg };
        }
        
        // Additional check for network mounts - verify they're still mounted
        if (connectivity.isNetwork) {
            const isMountActive = await withTimeout(
                execPromise(`mount | grep "${folderPath}"`),
                3000,
                'mount status check'
            );
            
            if (!isMountActive.stdout.trim()) {
                return { 
                    success: false, 
                    error: 'Network share is no longer mounted. Please remount to access.' 
                };
            }
        }
        
        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (process.env.NODE_ENV === 'development') {
            console.error(`Failed to safely open path ${folderPath}:`, error);
        }
        
        // Provide user-friendly error messages
        if (errorMessage.includes('timeout')) {
            notifyNetworkTimeout(folderPath);
            return { 
                success: false, 
                error: 'Network share is not responding. The connection may have been lost.' 
            };
        } else if (errorMessage.includes('No such file')) {
            await notifyShareInaccessible(path.basename(folderPath));
            return { 
                success: false, 
                error: 'The network share location no longer exists.' 
            };
        } else {
            await notifyShareInaccessible(path.basename(folderPath));
            return { 
                success: false, 
                error: 'Unable to access the network share. Please check your connection.' 
            };
        }
    }
}

export function isDirectory(stats: Stats): boolean {
    return stats.isDirectory();
}

export function getFullPath(basePath: string, relativePath: string): string {
    return path.join(basePath, relativePath);
}