// Main entry point for the Electron application - handles app lifecycle and IPC communication

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import os from 'os';
import { createTray, updateTrayMenu } from './tray';
import { createMainWindow, showMainWindow, createMountWindow, createSettingsWindow, createAboutWindow, closeAboutWindow } from './windows';
import { mountSMBShare, unmountSMBShare, storeCredentials, getStoredCredentials, validateMountedShares, cleanupOrphanedMountDirs } from './mount/smbService';
import { readDirectoryContents, safeOpenPath } from './mount/fileSystem';
import { connectionStore, SavedConnection } from './utils/connectionStore';
import { createAutoMountService, AutoMountService } from './utils/autoMountService';
import { createNetworkWatcher, NetworkWatcher } from './utils/networkWatcher';
import { MountedShare, MountResult, UnmountResult } from '../types';
import { 
    notifyNetworkOperationInProgress, 
    notifyNetworkOperationComplete, 
    notifyNetworkOperationFailed,
    notifyReconnectionAttempt,
    notifyReconnectionSuccess,
    notifyReconnectionFailed
} from './utils/networkNotifications';

// Global state to track mounted shares
let mountedShares: Map<string, MountedShare> = new Map();
let mainWindow: BrowserWindow | null = null;
let shareValidationInterval: NodeJS.Timeout | null = null;
let autoMountService: AutoMountService | null = null;
let networkWatcher: NetworkWatcher | null = null;
let isQuitting = false;

// Function to validate and refresh mounted shares
async function refreshMountedShares() {
    try {
        // First, clean up any orphaned mount directories
        const cleanedDirs = await cleanupOrphanedMountDirs();
        if (cleanedDirs.length > 0 && process.env.NODE_ENV === 'development') {
            console.log(`Cleaned up ${cleanedDirs.length} orphaned mount directories`);
        }
        
        // Validate currently tracked shares
        const disconnectedShares = await validateMountedShares(mountedShares);
        
        // Remove disconnected shares from our tracking
        for (const label of disconnectedShares) {
            mountedShares.delete(label);
            if (process.env.NODE_ENV === 'development') {
                console.log(`Removed disconnected share: ${label}`);
            }
        }
        
        // Update tray menu if any shares were disconnected
        if (disconnectedShares.length > 0) {
            updateTrayMenu(mountedShares);
            if (process.env.NODE_ENV === 'development') {
                console.log(`Updated tray menu after removing ${disconnectedShares.length} disconnected shares`);
            }
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
    
    // Initialize network watcher for auto-mounting after network changes
    networkWatcher = createNetworkWatcher(mountedShares);
    
    // Set up event listeners for network watcher
    if (networkWatcher) {
        networkWatcher.on('network-online', () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🟢 Network watcher detected network connection');
            }
        });
        
        networkWatcher.on('network-offline', () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🔴 Network watcher detected network disconnection');
            }
        });
        
        networkWatcher.on('internet-available', () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🌐 Internet connectivity restored');
            }
        });
        
        networkWatcher.on('mount-success', (result) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`✅ Auto-mount successful: ${result.connection.label}`);
            }
            updateTrayMenu(mountedShares);
        });
        
        networkWatcher.on('mount-failed-permanently', (result) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`❌ Auto-mount failed permanently: ${result.connection.label} - ${result.error}`);
            }
        });
        
        networkWatcher.on('mounts-validated', (disconnectedShares) => {
            if (disconnectedShares.length > 0 && process.env.NODE_ENV === 'development') {
                console.log(`🔍 Network watcher found ${disconnectedShares.length} disconnected shares`);
                updateTrayMenu(mountedShares);
            }
        });
        
        // Start the network watcher service
        await networkWatcher.start();
    }
    
    // Start periodic validation of mounted shares (every 30 seconds)
    shareValidationInterval = setInterval(refreshMountedShares, 30000);
    
    // Run initial cleanup
    await refreshMountedShares();
    
    // Perform auto-mounting of saved connections
    if (await connectionStore.getAutoMountEnabled()) {
        if (process.env.NODE_ENV === 'development') {
            console.log('Starting auto-mount process...');
        }
        try {
            const autoMountResults = await autoMountService.autoMountConnections();
            const summary = autoMountService.getAutoMountSummary(autoMountResults);
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-mount completed: ${summary.successful}/${summary.total} successful`);
                
                if (summary.successful > 0) {
                    console.log(`✅ Successfully mounted: ${summary.successfulConnections.join(', ')}`);
                }
                
                if (summary.failed > 0) {
                    console.log(`❌ Failed to mount: ${summary.failedConnections.map(f => `${f.name} (${f.error})`).join(', ')}`);
                }
            }
            
            if (summary.successful > 0) {
                // Update tray menu with new mounts
                updateTrayMenu(mountedShares);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Error during auto-mount process:', error);
            }
        }
    } else {
        if (process.env.NODE_ENV === 'development') {
            console.log('Auto-mount is disabled');
        }
    }
    
    if (process.env.NODE_ENV === 'development') {
        console.log('Attach app is ready!');
    }
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

// Function to attempt reconnection of a disconnected share
async function attemptShareReconnection(folderPath: string, shareName: string): Promise<void> {
    try {
        const { notifyReconnectionAttempt, notifyReconnectionSuccess, notifyReconnectionFailed } = require('./utils/networkNotifications');
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Attempting to reconnect share: ${shareName} at ${folderPath}`);
        }
        
        // Notify user that reconnection is being attempted
        await notifyReconnectionAttempt(shareName);
        
        // Check if we have connection info for this share
        let connectionInfo: SavedConnection | null = null;
        
        // Try to find connection by matching mount path or share path
        const connections = await connectionStore.getConnections();
        for (const conn of connections) {
            if (folderPath.includes(conn.label) || folderPath.includes(conn.sharePath.split('/').pop() || '')) {
                connectionInfo = conn;
                break;
            }
        }
        
        if (!connectionInfo) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`No saved connection found for ${shareName}`);
            }
            await notifyReconnectionFailed(shareName);
            return;
        }
        
        // Get the stored password
        const password = await connectionStore.getPassword(connectionInfo.id);
        if (!password) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`No stored password found for ${shareName}`);
            }
            await notifyReconnectionFailed(shareName);
            return;
        }
        
        // Attempt to remount
        try {
            const mountPoint = await mountSMBShare(connectionInfo.sharePath, connectionInfo.username, password);
            
            // Update our mounted shares tracking
            const mountedShare: MountedShare = {
                label: connectionInfo.label,
                mountPoint,
                sharePath: connectionInfo.sharePath,
                username: connectionInfo.username,
                mountedAt: new Date()
            };
            
            mountedShares.set(connectionInfo.label, mountedShare);
            updateTrayMenu(mountedShares);
            
            await notifyReconnectionSuccess(shareName);
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`Successfully reconnected ${shareName}`);
            }
            
        } catch (mountError) {
            if (process.env.NODE_ENV === 'development') {
                console.error(`Failed to remount ${shareName}:`, mountError);
            }
            await notifyReconnectionFailed(shareName);
        }
        
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error during reconnection attempt for ${shareName}:`, error);
        }
        const { notifyReconnectionFailed } = require('./utils/networkNotifications');
        await notifyReconnectionFailed(shareName);
    }
}

// Setup IPC handlers for communication with renderer processes
function setupIpcHandlers() {
    // Mount a network share
    ipcMain.handle('mount-share', async (event, sharePath: string, username: string, password: string, label?: string, saveCredentials: boolean = false, autoMount: boolean = false): Promise<MountResult> => {
        try {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Attempting to mount share: ${sharePath} for user: ${username}`);
            }
            
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
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Credentials stored securely for connection: ${savedConnection.id}`);
                    }
                } catch (credError) {
                    if (process.env.NODE_ENV === 'development') {
                        console.warn('Failed to store credentials:', credError);
                    }
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
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`Successfully mounted ${sharePath} at ${mountPoint}`);
            }
            
            return {
                success: true,
                message: `Successfully mounted ${sharePath}`,
                mountPoint,
                label: mountLabel
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Mount error:', error);
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                success: false,
                message: 'Failed to mount network share. Please check your connection details and try again.'
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Unmount error:', error);
            }
            return {
                success: false,
                message: 'Failed to unmount share. Please try again.'
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
                if (process.env.NODE_ENV === 'development') {
                    console.error(`Failed to unmount ${label}:`, error);
                }
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                results.push({
                    label,
                    success: false,
                    error: 'Failed to unmount share'
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

    // Open folder in Finder with enhanced timeout and user feedback
    ipcMain.handle('open-in-finder', async (event, folderPath: string) => {
        try {
            // Immediately notify user that operation is starting
            await notifyNetworkOperationInProgress(path.basename(folderPath));
            
            // Run safety check with aggressive timeout to prevent hanging
            const safetyCheck = await Promise.race([
                safeOpenPath(folderPath),
                new Promise<{success: boolean, error: string}>((resolve) => {
                    setTimeout(() => {
                        resolve({
                            success: false,
                            error: 'Network share is taking too long to respond. The connection may be slow or unavailable.'
                        });
                    }, 3000); // 3 second max timeout to prevent UI blocking
                })
            ]);
            
            if (!safetyCheck.success) {
                await notifyNetworkOperationFailed(path.basename(folderPath), safetyCheck.error || 'Unable to access path');
                
                // Check if it's a network share and offer reconnection
                if (folderPath.includes('/Volumes/') || folderPath.includes('smb://')) {
                    const shareName = path.basename(folderPath);
                    // Schedule background reconnection attempt
                    setImmediate(async () => {
                        await attemptShareReconnection(folderPath, shareName);
                    });
                }
                
                throw new Error(safetyCheck.error || 'Unable to access path');
            }
            
            // Attempt to open the path with timeout
            await Promise.race([
                shell.openPath(folderPath),
                new Promise<void>((_, reject) => {
                    setTimeout(() => {
                        reject(new Error('Opening folder timed out'));
                    }, 2000); // 2 second timeout for shell.openPath
                })
            ]);
            
            await notifyNetworkOperationComplete(path.basename(folderPath));
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
            const shareName = path.basename(folderPath);
            
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to open path:', error);
            }
            
            // Provide specific user feedback based on error type
            if (errorMessage.includes('timeout') || errorMessage.includes('taking too long')) {
                await notifyNetworkOperationFailed(shareName, 'Network share is not responding. Attempting to reconnect...');
                
                // Schedule background reconnection attempt
                setImmediate(async () => {
                    await attemptShareReconnection(folderPath, shareName);
                });
            } else {
                await notifyNetworkOperationFailed(shareName, errorMessage);
            }
            
            throw new Error(errorMessage);
        }
    });

    // Get folder contents with enhanced timeout protection
    ipcMain.handle('get-folder-contents', async (event, folderPath: string): Promise<string[]> => {
        try {
            // Use enhanced readDirectoryContents with aggressive timeout
            const contentsPromise = readDirectoryContents(folderPath);
            const timeoutPromise = new Promise<string[]>((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Directory listing timed out - network share may be unresponsive'));
                }, 5000); // 5 second timeout for directory listing
            });
            
            return await Promise.race([contentsPromise, timeoutPromise]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to read directory contents';
            
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to read directory:', error);
            }
            
            // Provide user feedback for directory listing failures
            if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
                await notifyNetworkOperationFailed(
                    path.basename(folderPath), 
                    'Directory listing timed out. Network share may be slow or disconnected.'
                );
            }
            
            throw new Error(errorMessage);
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to retrieve stored credentials:', error);
            }
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to retrieve connection credentials:', error);
            }
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to remove connection:', error);
            }
            return {
                success: false,
                message: 'Failed to remove connection'
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to update auto-mount setting:', error);
            }
            return {
                success: false,
                message: 'Failed to update auto-mount setting'
            };
        }
    });

    ipcMain.handle('update-connection', async (event, connectionId: string, connectionData: any): Promise<{success: boolean, message: string}> => {
        try {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                return {
                    success: false,
                    message: 'Connection not found'
                };
            }

            // Get the current password
            const currentPassword = await connectionStore.getPassword(connectionId);
            if (!currentPassword) {
                return {
                    success: false,
                    message: 'Connection password not found'
                };
            }

            // Update the connection with new data
            await connectionStore.saveConnection(
                connectionData.sharePath || connection.sharePath,
                connectionData.username || connection.username,
                currentPassword, // Keep the existing password
                connectionData.label || connection.label,
                connectionData.autoMount !== undefined ? connectionData.autoMount : connection.autoMount
            );

            return {
                success: true,
                message: 'Connection updated successfully'
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to update connection:', error);
            }
            return {
                success: false,
                message: 'Failed to update connection'
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
                    message: 'Failed to mount connection'
                };
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to mount saved connection:', error);
            }
            return {
                success: false,
                message: 'Failed to mount connection'
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
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to cleanup orphaned mounts:', error);
            }
            return {
                success: false,
                cleanedCount: 0,
                message: 'Failed to cleanup orphaned mounts'
            };
        }
    });

    // Get network status from NetworkWatcher
    ipcMain.handle('get-network-status', async (event) => {
        if (!networkWatcher) {
            return {
                isOnline: false,
                hasNetworkConnectivity: false,
                canReachGateway: false,
                lastChecked: new Date()
            };
        }
        return networkWatcher.getNetworkStatus();
    });

    // Force network check and auto-mount attempt
    ipcMain.handle('force-network-check', async (event): Promise<{success: boolean, message: string}> => {
        if (!networkWatcher) {
            return {
                success: false,
                message: 'Network watcher service not available'
            };
        }
        
        try {
            const status = await networkWatcher.checkNetworkStatus();
            if (status.isOnline) {
                await networkWatcher.performInitialAutoMount();
                updateTrayMenu(mountedShares);
                return {
                    success: true,
                    message: 'Network check completed and auto-mount attempted'
                };
            } else {
                return {
                    success: false,
                    message: 'Network is not available'
                };
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to force network check:', error);
            }
            return {
                success: false,
                message: 'Network check failed'
            };
        }
    });

    // Restart network watcher service
    ipcMain.handle('restart-network-watcher', async (event): Promise<{success: boolean, message: string}> => {
        try {
            if (networkWatcher) {
                networkWatcher.stop();
            }
            
            networkWatcher = createNetworkWatcher(mountedShares);
            await networkWatcher.start();
            
            return {
                success: true,
                message: 'Network watcher service restarted successfully'
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to restart network watcher:', error);
            }
            return {
                success: false,
                message: 'Failed to restart network watcher'
            };
        }
    });

    // Settings-related IPC handlers
    
    // Open settings window
    ipcMain.handle('open-settings-window', async (event) => {
        createSettingsWindow();
    });

    // Get all settings
    ipcMain.handle('get-all-settings', async (event) => {
        return {
            startAtLogin: connectionStore.getStartAtLogin(),
            rememberCredentials: connectionStore.getRememberCredentials(),
            autoMountEnabled: connectionStore.getAutoMountEnabled(),
            mountLocation: connectionStore.getMountLocation(),
            networkWatcher: connectionStore.getNetworkWatcherSettings()
        };
    });

    // Save all settings
    ipcMain.handle('save-all-settings', async (event, settings) => {
        try {
            if (settings.startAtLogin !== undefined) {
                connectionStore.setStartAtLogin(settings.startAtLogin);
                
                // Set login item for macOS
                app.setLoginItemSettings({
                    openAtLogin: settings.startAtLogin,
                    name: 'Attach'
                });
            }
            
            if (settings.rememberCredentials !== undefined) {
                connectionStore.setRememberCredentials(settings.rememberCredentials);
            }
            
            if (settings.autoMountEnabled !== undefined) {
                connectionStore.setAutoMountEnabled(settings.autoMountEnabled);
            }
            
            if (settings.mountLocation !== undefined) {
                connectionStore.setMountLocation(settings.mountLocation);
            }
            
            if (settings.networkWatcher !== undefined) {
                connectionStore.setNetworkWatcherSettings(settings.networkWatcher);
                
                // Restart network watcher with new settings
                if (networkWatcher) {
                    networkWatcher.stop();
                    networkWatcher = createNetworkWatcher(mountedShares);
                    await networkWatcher.start();
                }
            }
            
            return { success: true, message: 'Settings saved successfully' };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to save settings:', error);
            }
            return { 
                success: false, 
                message: 'Failed to save settings'
            };
        }
    });

    // Select directory for mount location
    ipcMain.handle('select-directory', async (event, currentPath?: string) => {
        try {
            const result = await dialog.showOpenDialog({
                title: 'Select Mount Location',
                defaultPath: currentPath || os.homedir(),
                properties: ['openDirectory', 'createDirectory']
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
                return { success: true, path: result.filePaths[0] };
            }
            
            return { success: false, path: null };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to open directory dialog:', error);
            }
            return { success: false, path: null };
        }
    });

    // Get user home directory
    ipcMain.handle('get-home-directory', async (event) => {
        return os.homedir();
    });

    // Clear all data
    ipcMain.handle('clear-all-data', async (event) => {
        try {
            // First unmount all current shares
            for (const [label, share] of mountedShares.entries()) {
                try {
                    await unmountSMBShare(share.mountPoint);
                    mountedShares.delete(label);
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error(`Failed to unmount ${label}:`, error);
                    }
                }
            }
            
            // Clear all stored connections and settings
            await connectionStore.clearAll();
            
            // Update tray menu
            updateTrayMenu(mountedShares);
            
            return { success: true, message: 'All data cleared successfully' };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to clear all data:', error);
            }
            return { 
                success: false, 
                message: 'Failed to clear data'
            };
        }
    });

    // Open connection manager (placeholder - could be a separate window or modal)
    ipcMain.handle('open-connection-manager', async (event) => {
        // For now, we'll just return the connections data
        // This could be expanded to open a dedicated connection management window
        try {
            const connections = await connectionStore.getConnections();
            return { success: true, connections };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to get connections:', error);
            }
            return { 
                success: false, 
                connections: [],
                message: 'Failed to get connections'
            };
        }
    });

    // About window handlers
    ipcMain.handle('open-about-window', async (event) => {
        createAboutWindow();
    });

    ipcMain.handle('close-about-window', async (event) => {
        closeAboutWindow();
    });

    // System information handler
    ipcMain.handle('get-system-info', async (event) => {
        try {
            const packageJson = require('../../package.json');
            const assetsPath = app.isPackaged 
                ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')
                : path.join(process.cwd(), 'assets');
            
            return {
                appVersion: packageJson.version || '1.0.0',
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node,
                platform: `${os.type()} ${os.release()}`,
                arch: os.arch(),
                assetsPath: assetsPath
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to get system info:', error);
            }
            const assetsPath = app.isPackaged 
                ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')
                : path.join(process.cwd(), 'assets');
            
            return {
                appVersion: '1.0.0',
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node,
                platform: `${os.type()} ${os.release()}`,
                arch: os.arch(),
                assetsPath: assetsPath
            };
        }
    });

    // Open external URL handler
    ipcMain.handle('open-external', async (event, url: string) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to open external URL:', error);
            }
            return { success: false, error: 'Failed to open URL' };
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
        
        // Stop network watcher service
        if (networkWatcher) {
            networkWatcher.stop();
        }
        
        // Unmount all shares before quitting
        if (process.env.NODE_ENV === 'development') {
            console.log('App is quitting, unmounting all shares...');
        }
        for (const [label, share] of mountedShares.entries()) {
            try {
                await unmountSMBShare(share.mountPoint);
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Unmounted ${share.sharePath}`);
                }
            } catch (error) {
                if (process.env.NODE_ENV === 'development') {
                    console.error(`Failed to unmount ${share.sharePath}:`, error);
                }
            }
        }
        
        // Now actually quit
        app.quit();
    }
});

// Ensure proper cleanup when the app is about to exit
app.on('will-quit', () => {
    if (process.env.NODE_ENV === 'development') {
        console.log('App is exiting...');
    }
});