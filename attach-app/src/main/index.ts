// Main entry point for the Electron application - handles app lifecycle and IPC communication

import { app, BrowserWindow, ipcMain, shell, dialog, powerMonitor } from 'electron';
import path from 'path';
import os from 'os';
import { createTray, updateTrayMenu, updateTrayNetworkStatus } from './tray';
import { createMainWindow, showMainWindow, createMountWindow, createSettingsWindow, createAboutWindow, closeAboutWindow } from './windows';
import { mountSMBShare, unmountSMBShare, storeCredentials, getStoredCredentials, validateMountedShares, cleanupOrphanedMountDirs, quickConnectivityCheck } from './mount/smbService';
import { readDirectoryContents, safeOpenPath } from './mount/fileSystem';
import { connectionStore, SavedConnection } from './utils/connectionStore';
import { createAutoMountService, AutoMountService } from './utils/autoMountService';
import { createNetworkWatcher, NetworkWatcher } from './utils/networkWatcher';
import { MountCoordinator } from './utils/mountCoordinator';
import { MountedShare, MountResult, UnmountResult } from '../types';

// Global state to track mounted shares
let mountedShares: Map<string, MountedShare> = new Map();
let mainWindow: BrowserWindow | null = null;
let shareValidationInterval: NodeJS.Timeout | null = null;
let autoMountService: AutoMountService | null = null;
let networkWatcher: NetworkWatcher | null = null;
let mountCoordinator: MountCoordinator;
let isQuitting = false;

// **NEW: Global auto-mount operation lock to prevent race conditions**
let isAutoMountInProgress = false;
let pendingAutoMountTriggers: Set<'startup' | 'network' | 'wake' | 'manual'> = new Set();

// Function to notify all windows when shares change
function notifySharesChanged() {
    const sharesList = Array.from(mountedShares.values());
    
    // Notify main window if it exists
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shares-changed', sharesList);
    }
    
    // Can add other windows here if needed
    if (process.env.NODE_ENV === 'development') {
        console.log(`📢 Notified windows of share changes. Current shares: ${sharesList.length}`);
    }
}

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
            
            // Notify windows of share changes
            notifySharesChanged();
            
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
    
    // Initialize mount coordinator singleton
    mountCoordinator = MountCoordinator.getInstance();
    
    // **NEW: Set auto-mount service reference in tray for cleanup functionality**
    const { setAutoMountServiceReference } = require('./tray');
    setAutoMountServiceReference(autoMountService);
    
    // Initialize network watcher for auto-mounting after network changes
    networkWatcher = createNetworkWatcher(mountedShares);
    
    // Set up event listeners for network watcher
    if (networkWatcher) {
        // **NEW: VPN status monitoring and event handling**
        networkWatcher.on('vpn-connected', async (vpnStatus) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔒 VPN Connected: ${vpnStatus.connectionName}`);
            }
            
            // Trigger auto-mount when VPN connects (shares might now be accessible)
            await handleEnhancedAutoMount('network');
        });
        
        networkWatcher.on('vpn-disconnected', (vpnStatus) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔓 VPN Disconnected: ${vpnStatus.connectionName}`);
            }
            
            // VPN disconnection might cause shares to become inaccessible
            // The share validation will handle cleanup
        });
        
        // Enhanced network status monitoring with tray updates
        networkWatcher.on('network-status-changed', (status) => {
            updateTrayNetworkStatus(status);
            if (process.env.NODE_ENV === 'development') {
                console.log('📊 Network status:', {
                    online: status.isOnline,
                    internet: status.hasInternet,
                    vpn: status.vpnStatus.isConnected ? `Connected (${status.vpnStatus.connectionName})` : 'Disconnected'
                });
            }
        });
        
        networkWatcher.on('network-online', async () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🟢 Network connected');
            }
            
            // Attempt auto-mount when network comes back online
            await handleNetworkReconnectionAutoMount();
        });
        
        networkWatcher.on('network-offline', () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🔴 Network disconnected');
            }
        });
        
        networkWatcher.on('internet-restored', async () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🌐 Internet connectivity restored');
            }
            
            // Attempt auto-mount when internet is restored
            await handleNetworkReconnectionAutoMount();
        });
        
        networkWatcher.on('internet-lost', () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🌐❌ Internet connectivity lost');
            }
        });
        
        networkWatcher.on('network-changed', ({ from, to }) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔄 Network changed: ${from} → ${to}`);
            }
        });
        
        // Share monitoring events
        networkWatcher.on('shares-disconnected', (shareLabels) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`📊 ${shareLabels.length} shares disconnected due to network issues`);
            }
            // Update tray menu to reflect disconnected shares
            updateTrayMenu(mountedShares);
        });
        
        // Auto-mount event from NetworkWatcher
        networkWatcher.on('auto-mount-requested', async () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('🔄 Auto-mount requested by NetworkWatcher');
            }
            await handleNetworkReconnectionAutoMount();
        });
        
        // Start the network watcher service
        await networkWatcher.start();
    }
    
    // **NEW: Set up system power monitoring for sleep/wake detection**
    setupPowerMonitoring();
    
    // Start periodic validation of mounted shares (every 30 seconds)
    shareValidationInterval = setInterval(refreshMountedShares, 30000);
    
    // Run initial cleanup and system-wide stale mount cleanup
    await refreshMountedShares();
    
    // **NEW: Clean up any stale system mounts before auto-mount**
    if (process.env.NODE_ENV === 'development') {
        console.log('🧹 Performing system-wide stale mount cleanup before auto-mount...');
    }
    try {
        const systemCleanup = await autoMountService.cleanupAllStaleMounts();
        if (systemCleanup.totalCleaned > 0) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`✅ System cleanup: removed ${systemCleanup.totalCleaned} stale mounts`);
                systemCleanup.cleanedMounts.forEach(mount => {
                    console.log(`   - ${mount.serverPath} (${mount.mountPoint})`);
                });
            }
        }
        if (systemCleanup.errors.length > 0) {
            if (process.env.NODE_ENV === 'development') {
                console.warn(`⚠️ System cleanup had ${systemCleanup.errors.length} errors:`, systemCleanup.errors);
            }
        }
    } catch (systemCleanupError) {
        if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ System-wide cleanup failed:', systemCleanupError);
        }
    }
    
    // Perform enhanced auto-mounting of saved connections
    await handleEnhancedAutoMount('startup');
    
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
    // Simplified: Just log attempt, no complex reconnection logic to prevent hanging
    if (process.env.NODE_ENV === 'development') {
        console.log(`Share reconnection simplified: ${shareName} at ${folderPath}`);
        console.log('Complex reconnection removed to prevent app hanging');
    }
}

// **NEW: Enhanced power monitoring for sleep/wake detection and system event handling**
function setupPowerMonitoring(): void {
    if (process.env.NODE_ENV === 'development') {
        console.log('🔌 Setting up power monitoring for sleep/wake detection...');
    }

    // System sleep detection - IMPROVED VERSION
    powerMonitor.on('suspend', async () => {
        if (process.env.NODE_ENV === 'development') {
            console.log('💤 System going to sleep - preparing shares for disconnection');
        }
        
        // **FIXED: Prevent auto-mount during sleep preparation**
        isAutoMountInProgress = true;
        
        // Gracefully disconnect shares before sleep to prevent hanging
        if (mountedShares.size > 0) {
            const shareLabels = Array.from(mountedShares.keys());
            if (process.env.NODE_ENV === 'development') {
                console.log(`💤 Disconnecting ${shareLabels.length} shares before sleep`);
            }
            
            const preSleepMounts = new Map(mountedShares); // Backup for wake validation
            const unmountResults = new Map<string, boolean>();
            
            for (const [label, share] of preSleepMounts.entries()) {
                try {
                    // **IMPROVED: Validate unmount success before adding to retry queue**
                    await unmountSMBShare(share.mountPoint);
                    
                    // Verify the unmount actually worked
                    const { isMountPoint } = await import('./mount/smbService');
                    const stillMounted = await isMountPoint(share.mountPoint);
                    
                    if (!stillMounted) {
                        // Successfully unmounted
                        mountedShares.delete(label);
                        unmountResults.set(label, true);
                        
                        // Only add to retry queue if actually unmounted
                        const connections = await connectionStore.getAutoMountConnections();
                        const connection = connections.find((c: SavedConnection) => 
                            c.sharePath === share.sharePath && 
                            c.username === share.username && 
                            c.autoMount
                        );
                        
                        if (connection && networkWatcher) {
                            networkWatcher.getShareMonitoringService().addToRetryQueue(connection);
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`✅ ${label} unmounted successfully, added to retry queue`);
                            }
                        }
                    } else {
                        // Unmount failed - don't add to retry queue to prevent duplicates
                        unmountResults.set(label, false);
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`⚠️ ${label} unmount failed - keeping in tracking, NOT adding to retry queue`);
                        }
                    }
                    
                } catch (error) {
                    // Unmount failed - don't remove from tracking or add to retry queue
                    unmountResults.set(label, false);
                    if (process.env.NODE_ENV === 'development') {
                        console.warn(`❌ Failed to unmount ${label} before sleep:`, error);
                        console.warn(`   Keeping in tracking to prevent duplicates on wake`);
                    }
                }
            }
            
            // Summary logging
            const successful = Array.from(unmountResults.values()).filter(Boolean).length;
            const failed = unmountResults.size - successful;
            if (process.env.NODE_ENV === 'development') {
                console.log(`💤 Sleep preparation: ${successful} unmounted, ${failed} failed/still mounted`);
            }
            
            updateTrayMenu(mountedShares);
        }
        
        // **NEW: Store sleep state to prevent wake race conditions**
        if (process.env.NODE_ENV === 'development') {
            console.log('💤 System sleep preparation complete');
        }
    });

    // System wake detection - IMPROVED VERSION
    powerMonitor.on('resume', async () => {
        if (process.env.NODE_ENV === 'development') {
            console.log('🌅 System waking up - initiating enhanced auto-mount recovery');
        }
        
        // **IMPROVED: Extended delay and comprehensive cleanup before auto-mount**
        setTimeout(async () => {
            try {
                // **NEW: Reset auto-mount lock after sleep (in case it got stuck)**
                isAutoMountInProgress = false;
                pendingAutoMountTriggers.clear();
                
                // **ENHANCED: Comprehensive system cleanup before auto-mount**
                if (process.env.NODE_ENV === 'development') {
                    console.log('🧹 Performing post-wake system cleanup...');
                }
                
                // Clean up any stale system mounts that may have survived sleep
                if (autoMountService) {
                    const systemCleanup = await autoMountService.cleanupAllStaleMounts();
                    if (systemCleanup.totalCleaned > 0 && process.env.NODE_ENV === 'development') {
                        console.log(`✅ Post-wake cleanup: removed ${systemCleanup.totalCleaned} stale system mounts`);
                    }
                }
                
                // **NEW: Enhanced validation of currently tracked mounts**
                if (mountedShares.size > 0) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔍 Validating ${mountedShares.size} tracked mounts after wake...`);
                    }
                    
                    // Use comprehensive validation that checks both accessibility and mount status
                    await refreshMountedShares();
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`📊 After validation: ${mountedShares.size} shares still valid`);
                    }
                }
                
                // Force network status refresh with extended timeout for post-wake networking
                if (networkWatcher) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🌐 Refreshing network status after wake...');
                    }
                    
                    const status = await networkWatcher.checkNetworkStatus();
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🌐 Post-wake network status: online=${status.isOnline}, internet=${status.hasInternet}`);
                    }
                    
                    // Only trigger auto-mount if network is ready and we have connections to mount
                    if (status.isOnline && status.hasInternet) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log('🔄 Network ready - triggering post-wake auto-mount...');
                        }
                        await handleEnhancedAutoMount('wake');
                    } else {
                        if (process.env.NODE_ENV === 'development') {
                            console.log('⚠️ Network not ready after wake, auto-mount will be triggered when network comes online');
                        }
                    }
                } else {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('⚠️ NetworkWatcher not available, triggering auto-mount anyway...');
                    }
                    await handleEnhancedAutoMount('wake');
                }
                
            } catch (error) {
                if (process.env.NODE_ENV === 'development') {
                    console.error('❌ Error during post-wake auto-mount recovery:', error);
                }
                
                // **NEW: Reset locks even if error occurs to prevent permanent blocking**
                isAutoMountInProgress = false;
                pendingAutoMountTriggers.clear();
            }
        }, 5000); // **INCREASED: 5 second delay for better network stabilization**
    });

    // System lock/unlock detection (macOS specific)
    powerMonitor.on('lock-screen', () => {
        if (process.env.NODE_ENV === 'development') {
            console.log('🔒 Screen locked');
        }
    });

    powerMonitor.on('unlock-screen', async () => {
        if (process.env.NODE_ENV === 'development') {
            console.log('🔓 Screen unlocked - checking network shares');
        }
        
        // Quick network check and potential auto-mount after unlock
        setTimeout(async () => {
            if (networkWatcher) {
                const status = await networkWatcher.refreshNetworkStatus();
                if (status.isOnline && status.hasInternet) {
                    await handleNetworkReconnectionAutoMount();
                }
            }
        }, 1000);
    });

    if (process.env.NODE_ENV === 'development') {
        console.log('✅ Power monitoring setup complete');
    }
}

// **NEW: Enhanced auto-mount with intelligent scheduling and retry logic**
async function handleEnhancedAutoMount(trigger: 'startup' | 'network' | 'wake' | 'manual' = 'manual'): Promise<void> {
    // **NEW: Check if auto-mount is already in progress**
    if (isAutoMountInProgress) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`⏳ Auto-mount already in progress, queuing trigger: ${trigger}`);
        }
        pendingAutoMountTriggers.add(trigger);
        return;
    }

    // **NEW: Set global lock**
    isAutoMountInProgress = true;
    
    try {
        if (!autoMountService) {
            if (process.env.NODE_ENV === 'development') {
                console.log('Auto-mount service not available');
            }
            return;
        }

        // Check if auto-mount is enabled
        const autoMountEnabled = await connectionStore.getAutoMountEnabled();
        if (!autoMountEnabled) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-mount is disabled, skipping ${trigger} auto-mount`);
            }
            return;
        }

        if (process.env.NODE_ENV === 'development') {
            console.log(`🚀 Starting enhanced auto-mount (trigger: ${trigger})`);
        }

        // Clean up any stale mounts first (except on manual trigger)
        if (trigger !== 'manual') {
            const systemCleanup = await autoMountService.cleanupAllStaleMounts();
            if (systemCleanup.totalCleaned > 0 && process.env.NODE_ENV === 'development') {
                console.log(`🧹 Cleaned up ${systemCleanup.totalCleaned} stale mounts before auto-mount`);
            }
        }

        // Perform auto-mount
        const autoMountResult = await autoMountService.autoMountConnections(trigger);
        const { results: autoMountResults, summary } = autoMountResult;
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`📊 Enhanced auto-mount completed (${trigger}): ${summary.successful}/${summary.totalAttempted} successful`);
            
            if (summary.successful > 0) {
                const successfulConnections = autoMountResults.filter(r => r.success).map(r => r.connection.label);
                console.log(`✅ Successfully mounted: ${successfulConnections.join(', ')}`);
            }
            
            if (summary.failed > 0) {
                const failedConnections = autoMountResults.filter(r => !r.success);
                console.log(`❌ Failed to mount: ${failedConnections.map(f => `${f.connection.label} (${f.error})`).join(', ')}`);
                
                // Add failed connections to retry queue for later attempts
                if (networkWatcher) {
                    const connections = await connectionStore.getAutoMountConnections();
                    for (const failedResult of failedConnections) {
                        const connection = connections.find((c: SavedConnection) => c.id === failedResult.connection.id);
                        if (connection && connection.autoMount) {
                            networkWatcher.getShareMonitoringService().addToRetryQueue(connection);
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`📋 Added ${connection.label} to retry queue for later reconnection`);
                            }
                        }
                    }
                }
            }
            
            if (summary.totalConflictsResolved > 0) {
                console.log(`🔧 Resolved ${summary.totalConflictsResolved} mount conflicts for: ${summary.connectionsWithConflicts.join(', ')}`);
            }
        }
        
        if (summary.successful > 0) {
            // Update tray menu with new mounts
            updateTrayMenu(mountedShares);
        }
        
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error during enhanced auto-mount (${trigger}):`, error);
        }
    } finally {
        // **NEW: Release global lock and process pending triggers**
        isAutoMountInProgress = false;
        
        // Process any pending triggers that came in while we were running
        if (pendingAutoMountTriggers.size > 0) {
            const nextTrigger = Array.from(pendingAutoMountTriggers)[0];
            pendingAutoMountTriggers.clear();
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔄 Processing pending auto-mount trigger: ${nextTrigger}`);
            }
            
            // Small delay to prevent tight loop
            setTimeout(() => {
                handleEnhancedAutoMount(nextTrigger);
            }, 1000);
        }
    }
}

// **UPDATED: Enhanced network reconnection auto-mount with retry logic**
async function handleNetworkReconnectionAutoMount(): Promise<void> {
    await handleEnhancedAutoMount('network');
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
            
            // Add to share monitoring
            if (networkWatcher) {
                networkWatcher.addMountedShareToMonitoring(mountedShare);
            }
            
            // Update tray menu with new shares
            updateTrayMenu(mountedShares);
            
            // Notify windows of share changes
            notifySharesChanged();
            
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
            
            // Remove from share monitoring
            if (networkWatcher) {
                networkWatcher.removeMountedShareFromMonitoring(label);
            }
            
            // Update tray menu
            updateTrayMenu(mountedShares);
            
            // Notify windows of share changes
            notifySharesChanged();

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
        
        // Notify windows of share changes
        notifySharesChanged();

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

    // **NEW: Clean up all stale system mounts (manual cleanup)**
    ipcMain.handle('cleanup-stale-mounts', async (event): Promise<{
        success: boolean;
        message: string;
        totalCleaned: number;
        cleanedMounts: Array<{ serverPath: string; mountPoint: string }>;
        errors: string[];
    }> => {
        try {
            if (process.env.NODE_ENV === 'development') {
                console.log('🧹 Manual stale mount cleanup requested from UI...');
            }

            if (!autoMountService) {
                return {
                    success: false,
                    message: 'Auto-mount service not available',
                    totalCleaned: 0,
                    cleanedMounts: [],
                    errors: ['Auto-mount service not initialized']
                };
            }

            const result = await autoMountService.cleanupAllStaleMounts();
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`🧹 Manual cleanup completed: ${result.totalCleaned} cleaned, ${result.errors.length} errors`);
            }

            return {
                success: result.errors.length === 0 || result.totalCleaned > 0,
                message: result.totalCleaned > 0 
                    ? `Successfully cleaned up ${result.totalCleaned} stale mount${result.totalCleaned > 1 ? 's' : ''}` 
                    : result.errors.length > 0 
                        ? 'No stale mounts found or cleanup failed'
                        : 'No stale mounts found',
                totalCleaned: result.totalCleaned,
                cleanedMounts: result.cleanedMounts,
                errors: result.errors
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('❌ Manual stale mount cleanup failed:', error);
            }
            return {
                success: false,
                message: 'Failed to clean up stale mounts',
                totalCleaned: 0,
                cleanedMounts: [],
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
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
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Failed to access path: ${safetyCheck.error}`);
                }
                
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
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`Successfully opened path: ${path.basename(folderPath)}`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
            const shareName = path.basename(folderPath);
            
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to open path:', error);
            }
            
            // Provide specific user feedback based on error type
            if (errorMessage.includes('timeout') || errorMessage.includes('taking too long')) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`${shareName}: Network share timeout, attempting reconnect`);
                }
                
                // Schedule background reconnection attempt
                setImmediate(async () => {
                    await attemptShareReconnection(folderPath, shareName);
                });
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
            
            // Simplified: Just log and throw error, no notifications
            if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`Directory listing timeout: ${path.basename(folderPath)}`);
                }
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

    ipcMain.handle('update-connection', async (event, connectionId: string, connectionData: any): Promise<{
        success: boolean; 
        message: string;
        needsRemount?: boolean;
        changes?: string[];
    }> => {
        try {
            // Use the improved update method
            const updateResult = await connectionStore.updateConnection(connectionId, {
                label: connectionData.label,
                sharePath: connectionData.sharePath,
                username: connectionData.username,
                autoMount: connectionData.autoMount
            });

            if (!updateResult.success) {
                return {
                    success: false,
                    message: updateResult.message
                };
            }

            // If no changes were made, return early
            if (!updateResult.changes || updateResult.changes.length === 0) {
                return {
                    success: true,
                    message: updateResult.message
                };
            }

            // Update mounted share details if the connection is currently mounted
            let mountUpdateResult;
            if (autoMountService && updateResult.connection) {
                mountUpdateResult = await autoMountService.updateMountedShareDetails(
                    connectionId, 
                    updateResult.connection
                );
            }

            // Determine if remounting is needed
            const criticalChanges = updateResult.changes.some(change => 
                change === 'sharePath' || change === 'username'
            );

            const needsRemount = criticalChanges || (mountUpdateResult?.needsRemount ?? false);

            let responseMessage = updateResult.message;
            if (mountUpdateResult?.wasUpdated) {
                responseMessage += mountUpdateResult.needsRemount 
                    ? ' Mount details updated - remount recommended.'
                    : ' Mount details updated successfully.';
            }

            if (process.env.NODE_ENV === 'development') {
                console.log(`📝 Connection update completed:`, {
                    changes: updateResult.changes,
                    needsRemount,
                    mountUpdated: mountUpdateResult?.wasUpdated
                });
            }

            return {
                success: true,
                message: responseMessage,
                needsRemount,
                changes: updateResult.changes
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

    // Auto-mount enhancement handlers
    ipcMain.handle('check-for-auto-mountable-connection', async (event, sharePath: string, username?: string): Promise<{
        hasAutoMountConnection: boolean;
        connection?: SavedConnection;
        shouldAutoMount: boolean;
        canMount: boolean;
        reason?: string;
    }> => {
        try {
            return await mountCoordinator.checkForAutoMountableConnection(sharePath, username);
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to check for auto-mountable connection:', error);
            }
            return {
                hasAutoMountConnection: false,
                shouldAutoMount: false,
                canMount: false,
                reason: 'Check failed'
            };
        }
    });

    ipcMain.handle('auto-mount-saved-connection', async (event, sharePath: string, username?: string): Promise<{
        success: boolean;
        mounted: boolean;
        connection?: SavedConnection;
        mountPoint?: string;
        message: string;
    }> => {
        try {
            const result = await mountCoordinator.autoMountSavedConnection(sharePath, username);
            
            // Update tray menu and monitoring if mount was successful
            if (result.success && result.mounted && result.mountPoint && result.connection) {
                const mountedShare: MountedShare = {
                    label: result.connection.label,
                    mountPoint: result.mountPoint,
                    sharePath: result.connection.sharePath,
                    username: result.connection.username,
                    mountedAt: new Date()
                };
                
                mountedShares.set(result.connection.label, mountedShare);
                
                // Add to share monitoring
                if (networkWatcher) {
                    networkWatcher.addMountedShareToMonitoring(mountedShare);
                }
                
                // Update tray menu
                updateTrayMenu(mountedShares);
                
                // Notify windows of share changes
                notifySharesChanged();
            }
            
            return result;
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to auto-mount saved connection:', error);
            }
            return {
                success: false,
                mounted: false,
                message: 'Auto-mount failed'
            };
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

    // Get comprehensive monitoring status (network, VPN, shares)
    ipcMain.handle('get-monitoring-status', async (event) => {
        if (!networkWatcher) {
            return {
                network: { isOnline: false, hasNetworkConnectivity: false, canReachGateway: false, lastChecked: new Date() },
                vpn: { isConnected: false, lastChecked: new Date() },
                shares: [],
                pendingMounts: [],
                mountAttempts: []
            };
        }
        return networkWatcher.getMonitoringStatus();
    });

    // Force share health check
    ipcMain.handle('force-share-health-check', async (event, label?: string): Promise<{success: boolean, message: string}> => {
        if (!networkWatcher) {
            return { success: false, message: 'Monitoring service not available' };
        }

        try {
            const shareMonitoring = networkWatcher.getShareMonitoringService();
            
            if (label) {
                // Check specific share
                await shareMonitoring.forceHealthCheck(label);
                return { success: true, message: `Health check completed for ${label}` };
            } else {
                // Check all shares
                const shareStatuses = shareMonitoring.getShareStatuses();
                const shareLabels = Array.from(shareStatuses.keys());
                
                for (const shareLabel of shareLabels) {
                    await shareMonitoring.forceHealthCheck(shareLabel);
                }
                
                return { success: true, message: `Health check completed for ${shareLabels.length} shares` };
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to perform health check:', error);
            }
            return { success: false, message: 'Health check failed' };
        }
    });

    // Force share reconnection
    ipcMain.handle('force-share-reconnection', async (event, label: string): Promise<{success: boolean, message: string}> => {
        if (!networkWatcher) {
            return { success: false, message: 'Monitoring service not available' };
        }

        try {
            await networkWatcher.forceShareReconnection(label);
            return { success: true, message: `Reconnection attempt initiated for ${label}` };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to force share reconnection:', error);
            }
            return { success: false, message: 'Failed to initiate reconnection' };
        }
    });

    // Quick connectivity check for server
    ipcMain.handle('quick-connectivity-check', async (event, serverName: string): Promise<{accessible: boolean, method?: string, error?: string}> => {
        try {
            return await quickConnectivityCheck(serverName, 5000);
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Quick connectivity check failed:', error);
            }
            return { 
                accessible: false, 
                error: error instanceof Error ? error.message : 'Connectivity check failed' 
            };
        }
    });

    // Get share monitoring statistics - simplified for minimal monitoring
    ipcMain.handle('get-share-monitoring-stats', async (event) => {
        if (!networkWatcher) {
            return { shares: [], reconnectionStats: [], isActive: false };
        }

        const shareMonitoring = networkWatcher.getShareMonitoringService();

        // Return minimal stats since we removed complex monitoring
        return {
            shares: [],
            reconnectionStats: [],
            isActive: shareMonitoring.isActive()
        };
    });

    // Start/stop share monitoring
    ipcMain.handle('toggle-share-monitoring', async (event, enable: boolean): Promise<{success: boolean, message: string}> => {
        if (!networkWatcher) {
            return { success: false, message: 'Network watcher not available' };
        }

        try {
            const shareMonitoring = networkWatcher.getShareMonitoringService();
            
            if (enable && !shareMonitoring.isActive()) {
                await shareMonitoring.start();
                return { success: true, message: 'Share monitoring started' };
            } else if (!enable && shareMonitoring.isActive()) {
                shareMonitoring.stop();
                return { success: true, message: 'Share monitoring stopped' };
            } else {
                return { 
                    success: true, 
                    message: enable ? 'Share monitoring already active' : 'Share monitoring already stopped' 
                };
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to toggle share monitoring:', error);
            }
            return { success: false, message: 'Failed to toggle share monitoring' };
        }
    });

    // Handler for remounting a connection after editing (to apply changes)
    ipcMain.handle('remount-updated-connection', async (event, connectionId: string, oldLabel?: string): Promise<{
        success: boolean;
        message: string;
        mountPoint?: string;
        label?: string;
    }> => {
        try {
            if (!autoMountService) {
                return {
                    success: false,
                    message: 'Auto-mount service not initialized'
                };
            }

            const result = await autoMountService.remountUpdatedConnection(connectionId, oldLabel);
            
            if (result.success && result.mountPoint) {
                // Update tray menu to reflect changes
                updateTrayMenu(mountedShares);
                
                return {
                    success: true,
                    message: `Successfully remounted ${result.connection.label} with updated details`,
                    mountPoint: result.mountPoint,
                    label: result.connection.label
                };
            } else {
                return {
                    success: false,
                    message: result.error || 'Failed to remount connection'
                };
            }

        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to remount updated connection:', error);
            }
            return {
                success: false,
                message: `Failed to remount connection: ${error.message}`
            };
        }
    });

    // Handler to get connection mount status (useful for settings UI)
    ipcMain.handle('get-connection-mount-status', async (event, connectionId: string): Promise<{
        success: boolean;
        isMounted: boolean;
        mountedShare?: any;
        currentLabel?: string;
        hasLabelMismatch: boolean;
        message: string;
    }> => {
        try {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                return {
                    success: false,
                    isMounted: false,
                    hasLabelMismatch: false,
                    message: 'Connection not found'
                };
            }

            if (!autoMountService) {
                return {
                    success: true,
                    isMounted: false,
                    hasLabelMismatch: false,
                    message: 'Auto-mount service not available'
                };
            }

            const status = autoMountService.getConnectionMountStatus(connection);
            
            return {
                success: true,
                isMounted: status.isMounted,
                mountedShare: status.mountedShare ? {
                    label: status.mountedShare.label,
                    mountPoint: status.mountedShare.mountPoint,
                    mountedAt: status.mountedShare.mountedAt
                } : undefined,
                currentLabel: status.currentLabel,
                hasLabelMismatch: status.hasLabelMismatch,
                message: status.isMounted 
                    ? (status.hasLabelMismatch ? 'Mounted with outdated label' : 'Currently mounted') 
                    : 'Not mounted'
            };

        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to get connection mount status:', error);
            }
            return {
                success: false,
                isMounted: false,
                hasLabelMismatch: false,
                message: `Failed to get mount status: ${error.message}`
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