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
    
    if (mountedShares.size === 1) {
        // Single share - show direct action
        const shareLabel = Array.from(mountedShares.keys())[0];
        return `Open Folder (${shareLabel})`;
    }
    
    // Multiple shares - will be handled by submenu
    return 'Open Folder';
}

/**
 * Check if it's safe to open folder (fast network-aware check)
 */
function isOpenFolderSafe(): boolean {
    // Only allow if shares are mounted
    return mountedShares.size > 0;
}

/**
 * Create submenu for opening folders when multiple shares are mounted
 */
function createOpenFolderSubmenu(): any[] {
    if (mountedShares.size <= 1) {
        return []; // No submenu needed for 0 or 1 shares
    }
    
    const submenu: any[] = [];
    
    // Add option for each mounted share
    Array.from(mountedShares.values()).forEach(share => {
        submenu.push({
            label: `📁 ${share.label}`,
            click: async () => {
                await openSpecificShare(share);
            }
        });
    });
    
    // Add separator and "Open All" option if more than one share
    if (mountedShares.size > 1) {
        submenu.push(
            { type: 'separator' },
            {
                label: '📂 Open All Shares',
                click: async () => {
                    for (const share of mountedShares.values()) {
                        try {
                            await openSpecificShare(share);
                        } catch (error) {
                            if (process.env.NODE_ENV === 'development') {
                                console.error(`Failed to open ${share.label}:`, error);
                            }
                        }
                    }
                }
            }
        );
    }
    
    return submenu;
}

/**
 * Open a specific share with network safety checks
 */
async function openSpecificShare(share: any): Promise<void> {
    try {
        // **FAST NETWORK CHECK**: Perform immediate real-time network check
        const { checkNetworkConnectivity } = require('./utils/networkWatcher');
        let isNetworkOnline = currentNetworkStatus?.isOnline || false;
        
        // If network status is stale (older than 2 seconds), do immediate check
        const statusAge = currentNetworkStatus ? Date.now() - currentNetworkStatus.lastChecked.getTime() : Infinity;
        if (statusAge > 2000) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔄 Checking network connectivity for ${share.label}...`);
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

        // Check network connectivity
        if (!isNetworkOnline) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🚫 Cannot open ${share.label}: Network is disconnected`);
            }
            
            // Import essential notifications for user feedback
            const { notifyNetworkDisconnected } = require('./utils/essentialNotifications');
            await notifyNetworkDisconnected();
            return;
        }

        // Use safe path opening with timeout protection
        const { safeOpenPath } = require('./mount/fileSystem');
        
        // Perform safety check with timeout
        const safetyCheck = await Promise.race([
            safeOpenPath(share.mountPoint),
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
                console.log(`Failed to access ${share.label}: ${safetyCheck.error}`);
            }
            
            // Show user-friendly notification
            const { notifySharesDisconnected } = require('./utils/essentialNotifications');
            await notifySharesDisconnected(1);
            return;
        }
        
        // Attempt to open the path with timeout
        await Promise.race([
            shell.openPath(share.mountPoint),
            new Promise<void>((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Opening folder timed out'));
                }, 2000); // 2 second timeout for shell.openPath
            })
        ]);
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`Opened folder: ${share.label} (${share.mountPoint})`);
        }
        
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Failed to open ${share.label}:`, error);
        }
        
        // Show user-friendly error notification
        const errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
        if (errorMessage.includes('timeout') || errorMessage.includes('taking too long')) {
            const { notifySharesDisconnected } = require('./utils/essentialNotifications');
            await notifySharesDisconnected(1);
        }
    }
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

    // Create the Open Folder menu item - either direct action or submenu
    const openFolderSubmenu = createOpenFolderSubmenu();
    const openFolderMenuItem: any = {
        label: getOpenFolderLabel(),
        enabled: isOpenFolderSafe()
    };

    if (openFolderSubmenu.length > 0) {
        // Multiple shares - use submenu
        openFolderMenuItem.submenu = openFolderSubmenu;
    } else if (mountedShares.size === 1) {
        // Single share - direct click action
        openFolderMenuItem.click = async () => {
            const firstShare = Array.from(mountedShares.values())[0];
            await openSpecificShare(firstShare);
        };
    } else {
        // No shares - disabled item (already handled by enabled: false)
        openFolderMenuItem.click = () => {
            // Do nothing - item should be disabled
        };
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
        openFolderMenuItem,
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