// Main entry point for the Electron application - handles app lifecycle and IPC communication

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { createTray, updateTrayMenu } from './tray';
import { createMainWindow, showMainWindow, createMountWindow } from './windows';
import { mountSMBShare, unmountSMBShare, storeCredentials, getStoredCredentials, validateMountedShares, cleanupOrphanedMountDirs } from './mount/smbService';
import { readDirectoryContents } from './mount/fileSystem';
import { connectionStore, SavedConnection } from './utils/connectionStore';
import { createAutoMountService, AutoMountService } from './utils/autoMountService';
import { MountedShare, MountResult, UnmountResult } from '../types';

// Global state to track mounted shares
let mountedShares: Map<string, MountedShare> = new Map();
let mainWindow: BrowserWindow | null = null;
let shareValidationInterval: NodeJS.Timeout | null = null;
let autoMountService: AutoMountService | null = null;
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
app.whenReady().then(async () => {
    // Create the main window
    mainWindow = createMainWindow();
    
    // Create the tray
    createTray(mainWindow);
    
    // Show the main window initially (can be hidden by tray interaction)
    mainWindow.show();
    
    // Set up IPC handlers
    setupIpcHandlers();
    
    // Initialize auto-mount service
    autoMountService = createAutoMountService(mountedShares);
    
    // Start periodic validation of mounted shares (every 30 seconds)
    shareValidationInterval = setInterval(refreshMountedShares, 30000);
    
    // Run initial cleanup
    await refreshMountedShares();
    
    // Perform auto-mounting of saved connections
    if (await connectionStore.getAutoMountEnabled()) {
        console.log('Starting auto-mount process...');
        try {
            const autoMountResults = await autoMountService.autoMountConnections();
            const summary = autoMountService.getAutoMountSummary(autoMountResults);
            
            console.log(`Auto-mount completed: ${summary.successful}/${summary.total} successful`);
            
            if (summary.successful > 0) {
                console.log(`✅ Successfully mounted: ${summary.successfulConnections.join(', ')}`);
                // Update tray menu with new mounts
                updateTrayMenu(mountedShares);
            }
            
            if (summary.failed > 0) {
                console.log(`❌ Failed to mount: ${summary.failedConnections.map(f => `${f.name} (${f.error})`).join(', ')}`);
            }
        } catch (error) {
            console.error('Error during auto-mount process:', error);
        }
    } else {
        console.log('Auto-mount is disabled');
    }
    
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
    ipcMain.handle('mount-share', async (event, sharePath: string, username: string, password: string, label?: string, saveCredentials: boolean = false, autoMount: boolean = false): Promise<MountResult> => {
        try {
            console.log(`Attempting to mount share: ${sharePath} for user: ${username}`);
            
            const mountPoint = await mountSMBShare(sharePath, username, password);
            const mountLabel = label || `${sharePath.split('/').pop()} (${username})`;
            
            // Save connection if credentials should be stored
            if (saveCredentials && connectionStore.getRememberCredentials()) {
                try {
                    const savedConnection = await connectionStore.saveConnection(
                        sharePath, 
                        username, 
                        password, 
                        mountLabel,
                        autoMount
                    );
                    console.log(`Credentials stored securely for connection: ${savedConnection.id}`);
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
            // Try to find a saved connection for this share path
            const connection = connectionStore.findConnectionByShareAndUser(sharePath);
            if (connection) {
                const password = await connectionStore.getPassword(connection.id);
                if (password) {
                    return {
                        username: connection.username,
                        password: password
                    };
                }
            }

            // Fallback to legacy method for backwards compatibility
            const serviceKey = `attach-app-${sharePath}`;
            const storedPassword = await getStoredCredentials(serviceKey, 'stored-user');
            if (storedPassword) {
                return {
                    username: 'stored-user',
                    password: storedPassword
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to retrieve stored credentials:', error);
            return null;
        }
    });

    // Connection management handlers
    ipcMain.handle('get-saved-connections', async (event): Promise<SavedConnection[]> => {
        return await connectionStore.getConnections();
    });

    ipcMain.handle('get-recent-connections', async (event, limit?: number): Promise<SavedConnection[]> => {
        return await connectionStore.getRecentConnections(limit);
    });

    ipcMain.handle('get-connection-credentials', async (event, connectionId: string): Promise<{username: string, password: string} | null> => {
        try {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                return null;
            }

            const password = await connectionStore.getPassword(connectionId);
            if (!password) {
                return null;
            }

            return {
                username: connection.username,
                password: password
            };
        } catch (error) {
            console.error('Failed to retrieve connection credentials:', error);
            return null;
        }
    });

    ipcMain.handle('remove-saved-connection', async (event, connectionId: string): Promise<{success: boolean, message: string}> => {
        try {
            const success = await connectionStore.removeConnection(connectionId);
            return {
                success,
                message: success ? 'Connection removed successfully' : 'Connection not found'
            };
        } catch (error) {
            console.error('Failed to remove connection:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    ipcMain.handle('update-connection-auto-mount', async (event, connectionId: string, autoMount: boolean): Promise<{success: boolean, message: string}> => {
        try {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                return {
                    success: false,
                    message: 'Connection not found'
                };
            }

            // Update the connection with new auto-mount setting
            await connectionStore.saveConnection(
                connection.sharePath,
                connection.username,
                await connectionStore.getPassword(connectionId) || '',
                connection.label,
                autoMount
            );

            return {
                success: true,
                message: 'Auto-mount setting updated'
            };
        } catch (error) {
            console.error('Failed to update auto-mount setting:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    ipcMain.handle('mount-saved-connection', async (event, connectionId: string): Promise<MountResult> => {
        try {
            if (!autoMountService) {
                throw new Error('Auto-mount service not initialized');
            }

            const result = await autoMountService.remountConnection(connectionId);
            if (!result) {
                throw new Error('Connection not found');
            }

            if (result.success && result.mountPoint) {
                // Update tray menu
                updateTrayMenu(mountedShares);
                
                return {
                    success: true,
                    message: `Successfully mounted ${result.connection.label}`,
                    mountPoint: result.mountPoint,
                    label: result.connection.label
                };
            } else {
                return {
                    success: false,
                    message: result.error || 'Failed to mount connection'
                };
            }
        } catch (error) {
            console.error('Failed to mount saved connection:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    ipcMain.handle('get-auto-mount-settings', async (event): Promise<{autoMountEnabled: boolean, rememberCredentials: boolean}> => {
        return {
            autoMountEnabled: await connectionStore.getAutoMountEnabled(),
            rememberCredentials: await connectionStore.getRememberCredentials()
        };
    });

    ipcMain.handle('update-auto-mount-settings', async (event, settings: {autoMountEnabled?: boolean, rememberCredentials?: boolean}): Promise<void> => {
        if (settings.autoMountEnabled !== undefined) {
            await connectionStore.setAutoMountEnabled(settings.autoMountEnabled);
        }
        if (settings.rememberCredentials !== undefined) {
            await connectionStore.setRememberCredentials(settings.rememberCredentials);
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