// src/main/tray.ts
import { app, Tray, Menu, BrowserWindow, shell } from 'electron';
import path from 'path';
import { showMainWindow, createMountWindow, createSettingsWindow, createAboutWindow, quitApplication } from './windows';
import { unmountSMBShare } from './mount/smbService';
import { NetworkStatus } from './utils/networkWatcher';
import { AutoMountService } from './utils/autoMountService';

let tray: Tray | null = null;
let mountedShares: Map<string, any> = new Map(); // We'll update this from main process
let currentNetworkStatus: NetworkStatus | null = null;
let autoMountServiceRef: AutoMountService | null = null;

export function setAutoMountServiceReference(service: AutoMountService | null) {
    autoMountServiceRef = service;
}

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

/**
 * Update network status in tray
 */
export function updateTrayNetworkStatus(networkStatus: NetworkStatus) {
    currentNetworkStatus = networkStatus;
    updateTrayTooltip();
    updateTrayMenu(); // Refresh menu to show network status
}

/**
 * Update tray tooltip with network status
 */
function updateTrayTooltip() {
    if (!tray || !currentNetworkStatus) return;
    
    let tooltip = 'Attach - Network Share Mounter';
    
    if (!currentNetworkStatus.isOnline) {
        tooltip += '\n🔴 Network: Disconnected';
    } else if (!currentNetworkStatus.hasInternet) {
        tooltip += '\n🟡 Network: Connected (No Internet)';
    } else {
        tooltip += '\n🟢 Network: Connected';
        if (currentNetworkStatus.networkId) {
            tooltip += ` (${currentNetworkStatus.networkId})`;
        }
    }
    
    if (mountedShares.size > 0) {
        tooltip += `\n📁 ${mountedShares.size} share${mountedShares.size > 1 ? 's' : ''} mounted`;
    }
    
    tray.setToolTip(tooltip);
}

/**
 * Get network status label for tray menu
 */
function getNetworkStatusLabel(): string {
    if (!currentNetworkStatus) {
        return '🔍 Network: Checking...';
    }
    
    if (!currentNetworkStatus.isOnline) {
        return '🔴 Network: Disconnected';
    } else if (!currentNetworkStatus.hasInternet) {
        return '🟡 Network: Limited (No Internet)';
    } else {
        const networkName = currentNetworkStatus.networkId || 'Connected';
        return `🟢 Network: ${networkName}`;
    }
}

/**
 * Get smart label for "Open Folder" based on network and mount status
 */
function getOpenFolderLabel(): string {
    if (mountedShares.size === 0) {
        return 'Open Folder (No shares mounted)';
    }
    
    if (!currentNetworkStatus || !currentNetworkStatus.isOnline) {
        return 'Open Folder (Network offline - Read Only)';
    }
    
    return 'Open Folder';
}

/**
 * Check if it's safe to open folder (fast network-aware check)
 */
function isOpenFolderSafe(): boolean {
    // Only allow if shares are mounted
    return mountedShares.size > 0;
}

export function updateTrayMenu(shares?: Map<string, any>) {
    if (!tray) return;
    
    if (shares) {
        mountedShares = shares;
    }

    // Build mounted drives submenu - simplified to only show drive names and unmount option
    const mountedDrivesSubmenu: any[] = Array.from(mountedShares.values()).map(share => ({
        label: `${share.label} (${share.sharePath})`,
        submenu: [
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
            label: getOpenFolderLabel(),
            enabled: isOpenFolderSafe(),
            click: async () => {
                try {
                    if (mountedShares.size === 0) {
                        return;
                    }

                    // **FAST NETWORK CHECK**: Perform immediate real-time network check for faster response
                    const { checkNetworkConnectivity } = require('./utils/networkWatcher');
                    let isNetworkOnline = currentNetworkStatus?.isOnline || false;
                    
                    // If network status is stale (older than 2 seconds), do immediate check
                    const statusAge = currentNetworkStatus ? Date.now() - currentNetworkStatus.lastChecked.getTime() : Infinity;
                    if (statusAge > 2000) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log('🔄 Performing immediate network check for Open Folder...');
                        }
                        
                        try {
                            // Fast network check with 1 second timeout
                            const quickNetworkCheck = await Promise.race([
                                checkNetworkConnectivity(),
                                new Promise<{isOnline: boolean}>((resolve) => {
                                    setTimeout(() => resolve({isOnline: false}), 1000);
                                })
                            ]);
                            isNetworkOnline = quickNetworkCheck.isOnline;
                        } catch (error) {
                            // If quick check fails, assume offline for safety
                            isNetworkOnline = false;
                        }
                    }

                    // Check network connectivity (immediate or cached)
                    if (!isNetworkOnline) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log('🚫 Cannot open folder: Network is disconnected (immediate check)');
                        }
                        
                        // Import essential notifications for user feedback
                        const { notifyNetworkDisconnected } = require('./utils/essentialNotifications');
                        await notifyNetworkDisconnected();
                        return;
                    }

                    // Get the first mounted share
                    const firstShare = Array.from(mountedShares.values())[0];
                    
                    // Use safe path opening with timeout protection
                    const { safeOpenPath } = require('./mount/fileSystem');
                    
                    // Perform safety check with timeout
                    const safetyCheck = await Promise.race([
                        safeOpenPath(firstShare.mountPoint),
                        new Promise<{success: boolean, error: string}>((resolve) => {
                            setTimeout(() => {
                                resolve({
                                    success: false,
                                    error: 'Network share is taking too long to respond. The connection may be slow or unavailable.'
                                });
                            }, 3000); // 3 second timeout to prevent hanging
                        })
                    ]);
                    
                    if (!safetyCheck.success) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`Failed to access path: ${safetyCheck.error}`);
                        }
                        
                        // Show user-friendly notification
                        const { notifySharesDisconnected } = require('./utils/essentialNotifications');
                        await notifySharesDisconnected(1);
                        return;
                    }
                    
                    // Attempt to open the path with timeout
                    await Promise.race([
                        shell.openPath(firstShare.mountPoint),
                        new Promise<void>((_, reject) => {
                            setTimeout(() => {
                                reject(new Error('Opening folder timed out'));
                            }, 2000); // 2 second timeout for shell.openPath
                        })
                    ]);
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Opened folder: ${firstShare.mountPoint}`);
                    }
                    
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('Failed to open folder:', error);
                    }
                    
                    // Show user-friendly error notification
                    const errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
                    if (errorMessage.includes('timeout') || errorMessage.includes('taking too long')) {
                        const { notifySharesDisconnected } = require('./utils/essentialNotifications');
                        await notifySharesDisconnected(1);
                    }
                }
            }
        },
        {
            label: 'Mounted Drives',
            submenu: mountedDrivesSubmenu
        },
        {
            label: 'Unmount All Drives',
            enabled: mountedShares.size > 0,
            click: async () => {
                try {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('Unmount all drives and cleanup triggered from tray');
                    }
                    
                    // First, unmount all tracked shares
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
                    
                    // Clear all mounted shares from tracking
                    mountedShares.clear();
                    
                    // Then, cleanup any orphaned mount directories
                    const { cleanupOrphanedMountDirs } = require('./mount/smbService');
                    const cleanedDirs = await cleanupOrphanedMountDirs();
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Unmount all completed. Cleaned up ${cleanedDirs.length} orphaned mount directories`);
                    }
                    
                    // Update tray menu
                    updateTrayMenu(mountedShares);
                    
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('Failed to unmount all drives:', error);
                    }
                }
            }
        },
        {
            label: getNetworkStatusLabel(),
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'Cleanup Stale Mounts',
            click: async () => {
                try {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🧹 Manual stale mount cleanup triggered from tray...');
                    }
                    
                    if (autoMountServiceRef) {
                        const result = await autoMountServiceRef.cleanupAllStaleMounts();
                        
                        if (process.env.NODE_ENV === 'development') {
                            if (result.totalCleaned > 0) {
                                console.log(`✅ Tray cleanup: removed ${result.totalCleaned} stale mounts`);
                                result.cleanedMounts.forEach((mount: any) => {
                                    console.log(`   - ${mount.serverPath} (${mount.mountPoint})`);
                                });
                            } else {
                                console.log('🧹 Tray cleanup: no stale mounts found');
                            }
                            
                            if (result.errors.length > 0) {
                                console.warn(`⚠️ Tray cleanup had ${result.errors.length} errors:`, result.errors);
                            }
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development') {
                            console.warn('⚠️ Auto-mount service not available for cleanup');
                        }
                    }
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('❌ Tray stale mount cleanup failed:', error);
                    }
                }
            }
        },
        {
            label: 'Settings',
            click: () => {
                createSettingsWindow();
            }
        },
        {
            label: 'About',
            click: () => {
                createAboutWindow();
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