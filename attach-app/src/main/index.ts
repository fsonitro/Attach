// Main entry point for the Electron application - handles app lifecycle and IPC communication

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { createTray, updateTrayMenu } from './tray';
import { createMainWindow, showMainWindow, createMountWindow } from './windows';
import { mountSMBShare, unmountSMBShare, storeCredentials, getStoredCredentials, validateMountedShares, cleanupOrphanedMountDirs } from './mount/smbService';
import { readDirectoryContents } from './mount/fileSystem';
import { MountedShare, MountResult, UnmountResult } from '../types';

// Global state to track mounted shares
let mountedShares: Map<string, MountedShare> = new Map();
let mainWindow: BrowserWindow | null = null;
let shareValidationInterval: NodeJS.Timeout | null = null;
let isQuitting = false;

// Function to validate and refresh mounted shares
async function refreshMountedShares() {
    try {
        // First, clean up any orphaned mount directories
        const cleanedDirs = await cleanupOrphanedMountDirs();
        if (cleanedDirs.length > 0) {
            console.log(`Cleaned up ${cleanedDirs.length} orphaned mount directories`);
        }
        
        // Validate currently tracked shares
        const disconnectedShares = await validateMountedShares(mountedShares);
        
        // Remove disconnected shares from our tracking
        for (const label of disconnectedShares) {
            mountedShares.delete(label);
            console.log(`Removed disconnected share: ${label}`);
        }
        
        // Update tray menu if any shares were disconnected
        if (disconnectedShares.length > 0) {
            updateTrayMenu(mountedShares);
            console.log(`Updated tray menu after removing ${disconnectedShares.length} disconnected shares`);
        }
    } catch (error) {
        console.warn('Error during share validation:', error);
    }
}

// App ready handler
app.whenReady().then(() => {
    // Create the main window
    mainWindow = createMainWindow();
    
    // Create the tray
    createTray(mainWindow);
    
    // Show the main window initially (can be hidden by tray interaction)
    mainWindow.show();
    
    // Set up IPC handlers
    setupIpcHandlers();
    
    // Start periodic validation of mounted shares (every 30 seconds)
    shareValidationInterval = setInterval(refreshMountedShares, 30000);
    
    // Run initial cleanup
    refreshMountedShares();
    
    console.log('Attach app is ready!');
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On macOS, re-create window when dock icon is clicked
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    } else {
        showMainWindow();
    }
});

// Prevent multiple instances
app.on('second-instance', () => {
    showMainWindow();
});

// Setup IPC handlers for communication with renderer processes
function setupIpcHandlers() {
    // Mount a network share
    ipcMain.handle('mount-share', async (event, sharePath: string, username: string, password: string, label?: string, saveCredentials: boolean = false): Promise<MountResult> => {
        try {
            console.log(`Attempting to mount share: ${sharePath} for user: ${username}`);
            
            const mountPoint = await mountSMBShare(sharePath, username, password);
            const mountLabel = label || `Share-${Date.now()}`;
            
            // Optionally store credentials securely
            if (saveCredentials) {
                try {
                    await storeCredentials(`attach-app-${sharePath}`, username, password);
                    console.log('Credentials stored securely');
                } catch (credError) {
                    console.warn('Failed to store credentials:', credError);
                    // Don't fail the mount if credential storage fails
                }
            }
            
            // Store the mounted share info
            const mountedShare: MountedShare = {
                label: mountLabel,
                mountPoint,
                sharePath,
                username,
                mountedAt: new Date()
            };
            
            mountedShares.set(mountLabel, mountedShare);
            
            // Update tray menu with new shares
            updateTrayMenu(mountedShares);
            
            console.log(`Successfully mounted ${sharePath} at ${mountPoint}`);
            
            return {
                success: true,
                message: `Successfully mounted ${sharePath}`,
                mountPoint,
                label: mountLabel
            };
        } catch (error) {
            console.error('Mount error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                success: false,
                message: errorMessage
            };
        }
    });

    // Unmount a specific share
    ipcMain.handle('unmount-share', async (event, label: string): Promise<MountResult> => {
        try {
            const share = mountedShares.get(label);
            if (!share) {
                return {
                    success: false,
                    message: `No share found with label: ${label}`
                };
            }

            await unmountSMBShare(share.mountPoint);
            mountedShares.delete(label);
            
            // Update tray menu
            updateTrayMenu(mountedShares);

            return {
                success: true,
                message: `Successfully unmounted ${share.sharePath}`
            };
        } catch (error) {
            console.error('Unmount error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                success: false,
                message: errorMessage
            };
        }
    });

    // Unmount all shares
    ipcMain.handle('unmount-all', async (event): Promise<UnmountResult> => {
        const results = [];
        let overallSuccess = true;

        for (const [label, share] of mountedShares.entries()) {
            try {
                await unmountSMBShare(share.mountPoint);
                results.push({
                    label,
                    success: true
                });
                mountedShares.delete(label);
            } catch (error) {
                console.error(`Failed to unmount ${label}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                results.push({
                    label,
                    success: false,
                    error: errorMessage
                });
                overallSuccess = false;
            }
        }

        // Update tray menu after unmounting all
        updateTrayMenu(mountedShares);

        return {
            success: overallSuccess,
            message: overallSuccess ? 'All shares unmounted successfully' : 'Some shares failed to unmount',
            results
        };
    });

    // Get list of mounted shares
    ipcMain.handle('get-mounted-shares', async (event): Promise<MountedShare[]> => {
        return Array.from(mountedShares.values());
    });

    // Open mount window
    ipcMain.handle('open-mount-window', async (event) => {
        createMountWindow();
    });

    // Close mount window
    ipcMain.handle('close-mount-window', async (event) => {
        // This would be handled by the window itself
    });

    // Close main window
    ipcMain.handle('close-main-window', async (event) => {
        if (mainWindow) {
            mainWindow.hide();
        }
    });

    // Open folder in Finder
    ipcMain.handle('open-in-finder', async (event, folderPath: string) => {
        try {
            await shell.openPath(folderPath);
        } catch (error) {
            console.error('Failed to open path:', error);
            throw error;
        }
    });

    // Get folder contents
    ipcMain.handle('get-folder-contents', async (event, folderPath: string): Promise<string[]> => {
        try {
            return await readDirectoryContents(folderPath);
        } catch (error) {
            console.error('Failed to read directory:', error);
            throw error;
        }
    });

    // Get stored credentials for a share
    ipcMain.handle('get-stored-credentials', async (event, sharePath: string): Promise<{username: string, password: string} | null> => {
        try {
            const serviceKey = `attach-app-${sharePath}`;
            // For simplicity, we'll use a fixed username key to find stored credentials
            // In a real app, you might want to store a list of usernames per share
            const storedPassword = await getStoredCredentials(serviceKey, 'stored-user');
            if (storedPassword) {
                return {
                    username: 'stored-user', // This would be more sophisticated in a real app
                    password: storedPassword
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to retrieve stored credentials:', error);
            return null;
        }
    });

    // Manual cleanup of orphaned mounts
    ipcMain.handle('cleanup-orphaned-mounts', async (event): Promise<{success: boolean, cleanedCount: number, message: string}> => {
        try {
            const cleanedDirs = await cleanupOrphanedMountDirs();
            await refreshMountedShares(); // Refresh the current state
            
            return {
                success: true,
                cleanedCount: cleanedDirs.length,
                message: `Cleaned up ${cleanedDirs.length} orphaned mount directories`
            };
        } catch (error) {
            console.error('Failed to cleanup orphaned mounts:', error);
            return {
                success: false,
                cleanedCount: 0,
                message: `Failed to cleanup orphaned mounts: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    });
}

// Handle app termination
app.on('before-quit', async (event) => {
    if (!isQuitting) {
        event.preventDefault();
        isQuitting = true;
        (global as any).isQuitting = true;
        
        // Clear the validation interval
        if (shareValidationInterval) {
            clearInterval(shareValidationInterval);
        }
        
        // Unmount all shares before quitting
        console.log('App is quitting, unmounting all shares...');
        for (const [label, share] of mountedShares.entries()) {
            try {
                await unmountSMBShare(share.mountPoint);
                console.log(`Unmounted ${share.sharePath}`);
            } catch (error) {
                console.error(`Failed to unmount ${share.sharePath}:`, error);
            }
        }
        
        // Now actually quit
        app.quit();
    }
});

// Ensure proper cleanup when the app is about to exit
app.on('will-quit', () => {
    console.log('App is exiting...');
});