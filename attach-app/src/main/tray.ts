// src/main/tray.ts
import { app, Tray, Menu, BrowserWindow, shell, globalShortcut } from 'electron';
import path from 'path';
import { showMainWindow, createMountWindow, createSettingsWindow, createAboutWindow, quitApplication } from './windows';
import { unmountSMBShare } from './mount/smbService';
import { NetworkStatus } from './utils/networkWatcher';
import { AutoMountService } from './utils/autoMountService';

let tray: Tray | null = null;
let mountedShares: Map<string, any> = new Map(); // We'll update this from main process
let currentNetworkStatus: NetworkStatus | null = null;
let autoMountServiceRef: AutoMountService | null = null;

// Pagination state for tray menu scroll
let currentPage = 0;
const sharesPerPage = 7;

// Scroll wheel navigation state
let scrollTimeout: NodeJS.Timeout | null = null;
let isScrollingEnabled = true;
let isContinuousNavigation = false; // Track if user is navigating pages continuously

// **NEW: Track menu state to implement proper toggle behavior**
let isMenuOpen = false;
let menuCloseTimeout: NodeJS.Timeout | null = null;

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

    // Add scroll wheel event listener for pagination
    tray.on('mouse-enter', () => {
        // Reset any scroll timeout when mouse enters tray area
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }
    });

    // Reset continuous navigation when menu is manually opened
    tray.on('mouse-move', () => {
        // Stop continuous navigation if user manually interacts
        if (isContinuousNavigation) {
            setTimeout(() => {
                isContinuousNavigation = false;
            }, 500);
        }
    });

    // Handle right-click to show context menu with enhanced navigation
    tray.on('right-click', () => {
        // Update menu before showing to ensure current state
        updateTrayMenu();
        showContextMenu();
    });

    // Handle regular click - FIXED: Proper toggle behavior for menu
    tray.on('click', () => {
        // **FIXED**: Implement proper menu toggle behavior
        if (isMenuOpen) {
            // Menu is currently open, close it
            closeContextMenu();
        } else {
            // Menu is closed, open it
            const shareCount = mountedShares.size;
            
            if (shareCount === 0) {
                // No shares - show main window for user to add connections
                showMainWindow();
            } else {
                // Show context menu for share selection
                updateTrayMenu();
                showContextMenu();
            }
        }
    });

    // Set up global keyboard shortcuts for tray navigation
    setupTrayNavigationShortcuts();

    return tray;
}

/**
 * Destroy tray and cleanup resources
 */
export function destroyTray(): void {
    if (tray) {
        cleanupTrayNavigationShortcuts();
        
        // **NEW: Clean up menu state tracking**
        if (menuCloseTimeout) {
            clearTimeout(menuCloseTimeout);
            menuCloseTimeout = null;
        }
        isMenuOpen = false;
        
        tray.destroy();
        tray = null;
    }
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
 * Update tray tooltip with network status and navigation hints
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
        
        if (mountedShares.size > sharesPerPage) {
            const totalPages = Math.ceil(mountedShares.size / sharesPerPage);
            tooltip += `\n📄 Page ${currentPage + 1} of ${totalPages}`;
            tooltip += '\n⌨️ ⌘⇧↑/↓ to navigate';
        }
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
 * Truncate text for tray menu display
 */
function truncateTextForTray(text: string, maxLength: number = 25): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Get smart label for "Open Folder" based on network and mount status
 */
function getOpenFolderLabel(): string {
    if (mountedShares.size === 0) {
        return 'Open Folder (No shares mounted)';
    }
    
    if (mountedShares.size === 1) {
        // Single share - show direct action with truncated name
        const shareLabel = Array.from(mountedShares.keys())[0];
        const truncatedLabel = truncateTextForTray(shareLabel, 20); // Shorter for single item
        return `Open Folder (${truncatedLabel})`;
    }
    
    // Multiple shares - show count and indicate if there are many
    if (mountedShares.size > 20) {
        return `Open Folder (${mountedShares.size} shares)`;
    } else {
        return 'Open Folder';
    }
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
 * Implements scroll-like pagination with 7 shares per page and intuitive navigation
 */
function createOpenFolderSubmenu(): any[] {
    if (mountedShares.size <= 1) {
        return []; // No submenu needed for 0 or 1 shares
    }
    
    const submenu: any[] = [];
    const allShares = Array.from(mountedShares.values());
    const totalShares = allShares.length;
    const totalPages = Math.ceil(totalShares / sharesPerPage);
    
    // Ensure current page is within bounds
    if (currentPage >= totalPages) {
        currentPage = 0;
    }
    if (currentPage < 0) {
        currentPage = totalPages - 1;
    }
    
    // Add "Open All" option at the top
    if (mountedShares.size > 1) {
        submenu.push({
            label: `📂 Open All (${totalShares})`,
            toolTip: `Open all ${totalShares} mounted shares`,
            click: async () => {
                // Stop continuous navigation when user selects Open All
                isContinuousNavigation = false;
                for (const share of mountedShares.values()) {
                    try {
                        await openSpecificShare(share);
                        // Small delay between opens to prevent system overload
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } catch (error) {
                        if (process.env.NODE_ENV === 'development') {
                            console.error(`Failed to open ${share.label}:`, error);
                        }
                    }
                }
            }
        });
        
        submenu.push({ type: 'separator' });
    }
    
    // If there are more than 7 shares, show scroll-like navigation
    if (totalShares > sharesPerPage) {
        // Add scroll navigation info with visual indicators
        const scrollIndicator = '●'.repeat(Math.min(totalPages, 5));
        const currentIndicator = scrollIndicator.split('').map((dot, index) => 
            index === currentPage % 5 ? '◉' : '○'
        ).join('');
        
        submenu.push({
            label: `� Shares ${currentPage * sharesPerPage + 1}-${Math.min((currentPage + 1) * sharesPerPage, totalShares)} of ${totalShares}`,
            enabled: false
        });
        
        submenu.push({
            label: `${currentIndicator} Page ${currentPage + 1}/${totalPages}`,
            enabled: false
        });
        
        // Add simple navigation arrows
        submenu.push({
            label: currentPage > 0 ? '◀ Previous Page' : '◀ Previous (go to last)',
            click: () => {
                scrollToPreviousPage();
            }
        });
        
        submenu.push({
            label: currentPage < totalPages - 1 ? 'Next Page ▶' : 'Next (go to first) ▶',
            click: () => {
                scrollToNextPage();
            }
        });
        
        submenu.push({ type: 'separator' });
    }
    
    // Calculate which shares to show on current page
    const startIndex = currentPage * sharesPerPage;
    const endIndex = Math.min(startIndex + sharesPerPage, totalShares);
    const currentPageShares = allShares.slice(startIndex, endIndex);
    
    // Add current page shares with improved visual hierarchy
    currentPageShares.forEach((share, index) => {
        const globalIndex = startIndex + index + 1;
        const truncatedLabel = truncateTextForTray(share.label, 25);
        
        // Use different icons for visual variety and better recognition
        const icons = ['📁', '📂', '🗂️', '📋', '📄'];
        const icon = icons[index % icons.length];
        
        const displayLabel = totalShares > sharesPerPage 
            ? `${icon} ${globalIndex}. ${truncatedLabel}` 
            : `${icon} ${truncatedLabel}`;
            
        submenu.push({
            label: displayLabel,
            toolTip: `${share.label} (${share.sharePath})`,
            click: async () => {
                // Stop continuous navigation when user selects a share
                isContinuousNavigation = false;
                await openSpecificShare(share);
            }
        });
    });
    
    // Add convenience options for large lists
    if (totalPages > 2) {
        submenu.push({ type: 'separator' });
        submenu.push({
            label: '🔍 View All in Main Window',
            toolTip: 'Open main window to see all shares at once',
            click: () => {
                // Stop continuous navigation when user opens main window
                isContinuousNavigation = false;
                showMainWindow();
            }
        });
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
    const mountedDrivesSubmenu: any[] = Array.from(mountedShares.values()).map(share => {
        const truncatedLabel = truncateTextForTray(share.label, 25);
        const truncatedSharePath = truncateTextForTray(share.sharePath, 35);
        
        return {
            label: `${truncatedLabel} (${truncatedSharePath})`,
            toolTip: `${share.label} (${share.sharePath})`, // Full details on hover
            submenu: [
                {
                    label: `Unmount ${truncatedLabel}`,
                    toolTip: `Unmount ${share.label}`,
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
        };
    });

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
        {
            label: 'Keyboard Shortcuts',
            submenu: [
                {
                    label: '⌨️ Tray Navigation',
                    enabled: false
                },
                {
                    label: '⌘⇧↑  Previous Page',
                    enabled: mountedShares.size > sharesPerPage,
                    click: () => scrollToPreviousPage()
                },
                {
                    label: '⌘⇧↓  Next Page',
                    enabled: mountedShares.size > sharesPerPage,
                    click: () => scrollToNextPage()
                },
                {
                    label: '⌘⇧O  Open First Share',
                    enabled: mountedShares.size > 0,
                    click: () => {
                        const allShares = Array.from(mountedShares.values());
                        const startIndex = currentPage * sharesPerPage;
                        const firstShareOnPage = allShares[startIndex];
                        if (firstShareOnPage) {
                            openSpecificShare(firstShareOnPage);
                        }
                    }
                }
            ]
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

/**
 * **NEW: Helper functions for proper menu toggle behavior**
 */

/**
 * Show context menu and track its state
 */
function showContextMenu(): void {
    if (!tray) return;
    
    // Clear any existing close timeout
    if (menuCloseTimeout) {
        clearTimeout(menuCloseTimeout);
        menuCloseTimeout = null;
    }
    
    // Mark menu as open
    isMenuOpen = true;
    
    // Show the menu
    tray.popUpContextMenu();
    
    // Set up automatic state reset after menu closes
    // This handles cases where menu is closed by clicking elsewhere
    menuCloseTimeout = setTimeout(() => {
        isMenuOpen = false;
        menuCloseTimeout = null;
    }, 100); // Short delay to allow menu to appear
}

/**
 * Close context menu and reset state
 */
function closeContextMenu(): void {
    if (!tray) return;
    
    // Mark menu as closed
    isMenuOpen = false;
    
    // Clear any existing timeout
    if (menuCloseTimeout) {
        clearTimeout(menuCloseTimeout);
        menuCloseTimeout = null;
    }
    
    // Close the menu by showing an empty one briefly
    // This is a workaround since Electron doesn't have a direct closeMenu method
    const emptyMenu = Menu.buildFromTemplate([]);
    tray.setContextMenu(emptyMenu);
    
    // Restore the real menu after a brief moment
    setTimeout(() => {
        updateTrayMenu();
    }, 50);
}

/**
 * Scroll to previous page in tray menu (scroll-like navigation)
 * Automatically reopens tray menu for continuous navigation
 */
function scrollToPreviousPage(): void {
    if (!isScrollingEnabled) return;
    
    const totalShares = mountedShares.size;
    const totalPages = Math.ceil(totalShares / sharesPerPage);
    
    if (totalPages <= 1) return;
    
    // Smooth scroll behavior: go to previous page or wrap to last
    currentPage = currentPage > 0 ? currentPage - 1 : totalPages - 1;
    
    // Mark as continuous navigation
    isContinuousNavigation = true;
    
    // Debounce rapid scrolling
    isScrollingEnabled = false;
    updateTrayMenu(mountedShares);
    
    // Automatically reopen tray menu after a brief delay for continuous navigation
    setTimeout(() => {
        if (tray && isContinuousNavigation) {
            showContextMenu();
        }
        isScrollingEnabled = true;
    }, 250); // Optimized delay for smooth reopening
    
    // Reset continuous navigation after a longer delay
    setTimeout(() => {
        isContinuousNavigation = false;
    }, 2000); // Reset after 2 seconds of inactivity
}

/**
 * Scroll to next page in tray menu (scroll-like navigation)
 * Automatically reopens tray menu for continuous navigation
 */
function scrollToNextPage(): void {
    if (!isScrollingEnabled) return;
    
    const totalShares = mountedShares.size;
    const totalPages = Math.ceil(totalShares / sharesPerPage);
    
    if (totalPages <= 1) return;
    
    // Smooth scroll behavior: go to next page or wrap to first
    currentPage = currentPage < totalPages - 1 ? currentPage + 1 : 0;
    
    // Mark as continuous navigation
    isContinuousNavigation = true;
    
    // Debounce rapid scrolling
    isScrollingEnabled = false;
    updateTrayMenu(mountedShares);
    
    // Automatically reopen tray menu after a brief delay for continuous navigation
    setTimeout(() => {
        if (tray && isContinuousNavigation) {
            showContextMenu();
        }
        isScrollingEnabled = true;
    }, 250); // Optimized delay for smooth reopening
    
    // Reset continuous navigation after a longer delay
    setTimeout(() => {
        isContinuousNavigation = false;
    }, 2000); // Reset after 2 seconds of inactivity
}

/**
 * Set up global keyboard shortcuts for tray navigation
 * This provides scroll-like navigation accessible system-wide
 */
function setupTrayNavigationShortcuts(): void {
    try {
        // Register global shortcuts for tray navigation
        // These work even when the app is not focused
        
        // Ctrl+Shift+Up - Previous page in tray shares
        globalShortcut.register('CommandOrControl+Shift+Up', () => {
            if (mountedShares.size > sharesPerPage) {
                scrollToPreviousPage();
            }
        });
        
        // Ctrl+Shift+Down - Next page in tray shares
        globalShortcut.register('CommandOrControl+Shift+Down', () => {
            if (mountedShares.size > sharesPerPage) {
                scrollToNextPage();
            }
        });
        
        // Ctrl+Shift+O - Open current page's first share
        globalShortcut.register('CommandOrControl+Shift+O', () => {
            if (mountedShares.size > 0) {
                const allShares = Array.from(mountedShares.values());
                const startIndex = currentPage * sharesPerPage;
                const firstShareOnPage = allShares[startIndex];
                if (firstShareOnPage) {
                    openSpecificShare(firstShareOnPage);
                }
            }
        });
        
        if (process.env.NODE_ENV === 'development') {
            console.log('✅ Tray navigation shortcuts registered');
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error('Failed to register tray navigation shortcuts:', error);
        }
    }
}

/**
 * Clean up global shortcuts when tray is destroyed
 */
function cleanupTrayNavigationShortcuts(): void {
    try {
        globalShortcut.unregister('CommandOrControl+Shift+Up');
        globalShortcut.unregister('CommandOrControl+Shift+Down');
        globalShortcut.unregister('CommandOrControl+Shift+O');
        
        if (process.env.NODE_ENV === 'development') {
            console.log('✅ Tray navigation shortcuts cleaned up');
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error('Failed to cleanup tray navigation shortcuts:', error);
        }
    }
}