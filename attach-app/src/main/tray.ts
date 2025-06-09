// src/main/tray.ts
import { app, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { showMainWindow, createMountWindow, createSettingsWindow, quitApplication } from './windows';
import { unmountSMBShare } from './mount/smbService';

let tray: Tray | null = null;
let mountedShares: Map<string, any> = new Map(); // We'll update this from main process

export function createTray(mainWindow: BrowserWindow) {
    // Use folders icon for tray (22x22 optimized size with template for theme adaptation)
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons', 'folders-tray-template.png')
        : path.join(process.cwd(), 'assets', 'icons', 'folders-tray-template.png');
    tray = new Tray(iconPath);
    
    // Set as template image for automatic light/dark theme adaptation
    tray.setImage(iconPath);
    
    // This makes the icon adapt to light/dark themes properly
    tray.setTitle('');

    updateTrayMenu();

    tray.setToolTip('Attach - Network Share Mounter');

    // Tray icon click behavior is disabled - users must use the "Show App" menu option
    // This prevents accidental window opening when clicking the tray icon

    return tray;
}

export function updateTrayMenu(shares?: Map<string, any>) {
    if (!tray) return;
    
    if (shares) {
        mountedShares = shares;
    }

    // Build mounted drives submenu
    const mountedDrivesSubmenu: any[] = Array.from(mountedShares.values()).map(share => ({
        label: `${share.label} (${share.sharePath})`,
        submenu: [
            {
                label: 'Open in Finder',
                click: async () => {
                    try {
                        // Import notifications for feedback
                        const { notifyNetworkOperationInProgress, notifyNetworkOperationComplete, notifyNetworkOperationFailed } = require('./utils/networkNotifications');
                        
                        // Immediate user feedback
                        await notifyNetworkOperationInProgress(share.label);
                        
                        // Use safe path opening with aggressive timeout
                        const { safeOpenPath } = require('./mount/fileSystem');
                        const safetyCheckPromise = safeOpenPath(share.mountPoint);
                        const timeoutPromise = new Promise<{success: boolean, error?: string}>((resolve) => {
                            setTimeout(() => {
                                resolve({
                                    success: false,
                                    error: 'Network share is not responding'
                                });
                            }, 3000); // 3 second timeout
                        });
                        
                        const safetyCheck = await Promise.race([safetyCheckPromise, timeoutPromise]);
                        
                        if (!safetyCheck.success) {
                            await notifyNetworkOperationFailed(share.label, safetyCheck.error || 'Unable to access share');
                            
                            if (process.env.NODE_ENV === 'development') {
                                console.error(`Cannot open ${share.label}: ${safetyCheck.error}`);
                            }
                            return;
                        }
                        
                        // Attempt to open with timeout
                        await Promise.race([
                            shell.openPath(share.mountPoint),
                            new Promise<void>((_, reject) => {
                                setTimeout(() => reject(new Error('Open operation timed out')), 2000);
                            })
                        ]);
                        
                        await notifyNetworkOperationComplete(share.label);
                        
                    } catch (error) {
                        const { notifyNetworkOperationFailed } = require('./utils/networkNotifications');
                        const errorMessage = error instanceof Error ? error.message : 'Failed to open share';
                        
                        await notifyNetworkOperationFailed(share.label, errorMessage);
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.error(`Failed to open ${share.label} in Finder:`, error);
                        }
                    }
                }
            },
            {
                label: 'Browse Contents',
                click: async () => {
                    try {
                        // Import notifications for feedback
                        const { notifyNetworkOperationInProgress, notifyNetworkOperationComplete, notifyNetworkOperationFailed } = require('./utils/networkNotifications');
                        
                        // Immediate user feedback
                        await notifyNetworkOperationInProgress(`${share.label} contents`);
                        
                        // Use safe path opening with aggressive timeout
                        const { safeOpenPath } = require('./mount/fileSystem');
                        const safetyCheckPromise = safeOpenPath(share.mountPoint);
                        const timeoutPromise = new Promise<{success: boolean, error?: string}>((resolve) => {
                            setTimeout(() => {
                                resolve({
                                    success: false,
                                    error: 'Network share is not responding'
                                });
                            }, 3000); // 3 second timeout
                        });
                        
                        const safetyCheck = await Promise.race([safetyCheckPromise, timeoutPromise]);
                        
                        if (!safetyCheck.success) {
                            await notifyNetworkOperationFailed(`${share.label} contents`, safetyCheck.error || 'Unable to browse share');
                            
                            if (process.env.NODE_ENV === 'development') {
                                console.error(`Cannot browse ${share.label}: ${safetyCheck.error}`);
                            }
                            return;
                        }
                        
                        // This could show a submenu of folder contents in the future
                        // For now, just open the folder like "Open in Finder"
                        await Promise.race([
                            shell.openPath(share.mountPoint),
                            new Promise<void>((_, reject) => {
                                setTimeout(() => reject(new Error('Browse operation timed out')), 2000);
                            })
                        ]);
                        
                        await notifyNetworkOperationComplete(`${share.label} contents`);
                        
                    } catch (error) {
                        const { notifyNetworkOperationFailed } = require('./utils/networkNotifications');
                        const errorMessage = error instanceof Error ? error.message : 'Failed to browse share';
                        
                        await notifyNetworkOperationFailed(`${share.label} contents`, errorMessage);
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.error(`Failed to browse ${share.label}:`, error);
                        }
                    }
                }
            },
            { type: 'separator' },
            {
                label: `Unmount ${share.label}`,
                click: async () => {
                    try {
                        // Call the unmount function directly
                        await unmountSMBShare(share.mountPoint);
                        mountedShares.delete(share.label);
                        
                        // Update tray menu
                        updateTrayMenu(mountedShares);
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`Successfully unmounted ${share.label}`);
                        }
                    } catch (error) {
                        if (process.env.NODE_ENV === 'development') {
                            console.error(`Failed to unmount ${share.label}:`, error);
                        }
                    }
                }
            }
        ]
    }));

    // If no mounted drives, show empty message
    if (mountedDrivesSubmenu.length === 0) {
        mountedDrivesSubmenu.push({
            label: 'No mounted drives',
            enabled: false
        });
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => {
                showMainWindow();
            }
        },
        {
            label: 'Open Mounter',
            click: () => {
                createMountWindow();
            }
        },
        {
            label: 'Mounted Drives',
            submenu: mountedDrivesSubmenu
        },
        {
            label: 'Unmount All',
            enabled: mountedShares.size > 0,
            click: async () => {
                try {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('Unmount all triggered from tray');
                    }
                    
                    // Unmount all shares
                    for (const [label, share] of mountedShares.entries()) {
                        try {
                            await unmountSMBShare(share.mountPoint);
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`Successfully unmounted ${label}`);
                            }
                        } catch (error) {
                            if (process.env.NODE_ENV === 'development') {
                                console.error(`Failed to unmount ${label}:`, error);
                            }
                        }
                    }
                    
                    // Clear all mounted shares
                    mountedShares.clear();
                    
                    // Update tray menu
                    updateTrayMenu(mountedShares);
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log('Unmount all completed');
                    }
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('Failed to unmount all:', error);
                    }
                }
            }
        },
        {
            label: 'Cleanup Orphaned Mounts',
            click: async () => {
                try {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('Manual cleanup triggered from tray');
                    }
                    // Import the cleanup function and call it directly
                    const { cleanupOrphanedMountDirs } = require('./mount/smbService');
                    const cleanedDirs = await cleanupOrphanedMountDirs();
                    if (cleanedDirs.length > 0 && process.env.NODE_ENV === 'development') {
                        console.log(`Manually cleaned up ${cleanedDirs.length} orphaned mount directories`);
                    } else if (process.env.NODE_ENV === 'development') {
                        console.log('No orphaned mount directories found');
                    }
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('Failed to cleanup orphaned mounts:', error);
                    }
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => {
                createSettingsWindow();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                quitApplication();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}