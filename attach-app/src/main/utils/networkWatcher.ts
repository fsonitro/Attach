// src/main/utils/networkWatcher.ts
// Minimal network monitoring to prevent app hanging

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import * as dns from 'dns';
import * as https from 'https';
import { connectionStore, SavedConnection } from './connectionStore';
import { MountedShare } from '../../types';
import { createShareMonitoringService, ShareMonitoringService } from './shareMonitoringService';
import { customNetworkCheck } from './networkUtils';
import { 
    notifyNetworkDisconnected, 
    notifyNetworkReconnected, 
    notifyInternetLost, 
    notifyInternetRestored,
    notifyNetworkChanged,
    notifySharesDisconnected 
} from './essentialNotifications';

const execPromise = promisify(exec);

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

// Configuration constants
const NETWORK_CONFIG = {
    CHECK_INTERVAL: 5000,     // Check every 5 seconds for faster user feedback
    TIMEOUT_MS: 1000,         // 1 second timeout for network commands
    INTERNET_TIMEOUT_MS: 3000 // 3 seconds for internet connectivity check
} as const;

export interface NetworkStatus {
    isOnline: boolean;
    hasInternet: boolean;
    networkId: string | null; // To detect network changes
    lastChecked: Date;
}

export class NetworkWatcher extends EventEmitter {
    private readonly mountedShares: Map<string, MountedShare>;
    private readonly shareMonitoringService: ShareMonitoringService;
    private networkCheckInterval: NodeJS.Timeout | null = null;
    private currentNetworkStatus: NetworkStatus;
    private previousNetworkStatus: NetworkStatus | null = null;

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        super();
        this.mountedShares = mountedSharesRef;
        this.shareMonitoringService = createShareMonitoringService(mountedSharesRef);
        this.currentNetworkStatus = {
            isOnline: false,
            hasInternet: false,
            networkId: null,
            lastChecked: new Date()
        };
    }

    /**
     * Start minimal network monitoring
     */
    async start(): Promise<void> {
        if (process.env.NODE_ENV === 'development') {
            console.log('🌐 Starting minimal NetworkWatcher...');
        }
        
        // Initial network check
        await this.checkNetworkStatus();
        
        // Start minimal share monitoring
        await this.shareMonitoringService.start();
        
        // Start periodic network monitoring with fast intervals for responsive UI
        this.networkCheckInterval = setInterval(() => {
            this.checkNetworkStatus();
        }, NETWORK_CONFIG.CHECK_INTERVAL);

        if (process.env.NODE_ENV === 'development') {
            console.log('✅ Minimal NetworkWatcher started');
        }
    }

    /**
     * Stop network monitoring
     */
    stop(): void {
        if (process.env.NODE_ENV === 'development') {
            console.log('🛑 Stopping NetworkWatcher...');
        }
        
        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
        }
        
        this.shareMonitoringService.stop();
    }

    /**
     * Enhanced network status check with internet connectivity and network change detection
     */
    async checkNetworkStatus(): Promise<NetworkStatus> {
        try {
            // Store previous status for comparison
            this.previousNetworkStatus = { ...this.currentNetworkStatus };
            
            // Quick non-blocking checks
            const isOnline = await this.isNetworkOnline();
            const hasInternet = isOnline ? await this.hasInternetConnectivity() : false;
            const networkId = await this.getCurrentNetworkId();
            
            this.currentNetworkStatus = {
                isOnline,
                hasInternet,
                networkId,
                lastChecked: new Date()
            };
            
            // Emit status change event
            this.emit('network-status-changed', this.currentNetworkStatus);
            
            // Check for state changes and trigger essential notifications
            await this.handleNetworkStateChanges();
            
        } catch (error) {
            // On error, assume offline
            this.currentNetworkStatus = {
                isOnline: false,
                hasInternet: false,
                networkId: null,
                lastChecked: new Date()
            };
        }
        
        return this.currentNetworkStatus;
    }

    /**
     * Quick network check using custom DNS/HTTPS method for better reliability
     */
    private async isNetworkOnline(): Promise<boolean> {
        try {
            if (isDevelopment) console.log('🔍 [NetworkWatcher] Starting network connectivity check...');
            const result = await customNetworkCheck(NETWORK_CONFIG.TIMEOUT_MS);
            if (isDevelopment) console.log('🔍 [NetworkWatcher] Custom network check result:', result);
            return result;
        } catch (error) {
            if (isDevelopment) console.log('⚠️ [NetworkWatcher] Custom network check failed, falling back to ping:', error);
            // Fallback to ping if custom check fails
            try {
                if (isDevelopment) console.log('🏓 [NetworkWatcher] Attempting ping fallback to 8.8.8.8...');
                await execPromise('ping -c 1 -W 500 8.8.8.8', { timeout: NETWORK_CONFIG.TIMEOUT_MS });
                if (isDevelopment) console.log('✅ [NetworkWatcher] Ping fallback successful');
                return true;
            } catch (pingError) {
                if (isDevelopment) console.log('❌ [NetworkWatcher] Ping fallback also failed:', pingError);
                return false;
            }
        }
    }

    /**
     * Check internet connectivity using custom DNS/HTTPS method
     */
    private async hasInternetConnectivity(): Promise<boolean> {
        try {
            if (isDevelopment) console.log('🌐 [NetworkWatcher] Starting internet connectivity check...');
            const result = await customNetworkCheck(NETWORK_CONFIG.INTERNET_TIMEOUT_MS);
            if (isDevelopment) console.log('🌐 [NetworkWatcher] Custom internet check result:', result);
            return result;
        } catch (error) {
            if (isDevelopment) console.log('⚠️ [NetworkWatcher] Custom internet check failed, falling back to ping:', error);
            // Fallback to ping if custom check fails
            try {
                if (isDevelopment) console.log('🏓 [NetworkWatcher] Attempting ping fallback to 1.1.1.1...');
                await execPromise('ping -c 1 -W 1000 1.1.1.1', { timeout: NETWORK_CONFIG.INTERNET_TIMEOUT_MS });
                if (isDevelopment) console.log('✅ [NetworkWatcher] Internet ping fallback successful');
                return true;
            } catch (pingError) {
                if (isDevelopment) console.log('❌ [NetworkWatcher] Internet ping fallback also failed:', pingError);
                return false;
            }
        }
    }

    /**
     * Get current network identifier to detect network changes (optimized for speed)
     */
    private async getCurrentNetworkId(): Promise<string | null> {
        try {
            // Get current WiFi network name (SSID) on macOS with faster timeout
            const result = await execPromise('networksetup -getairportnetwork en0', { timeout: NETWORK_CONFIG.TIMEOUT_MS });
            const match = result.stdout.match(/Current Wi-Fi Network: (.+)/);
            return match ? match[1].trim() : null;
        } catch (error) {
            // Fall back to router/gateway IP as network identifier with faster timeout
            try {
                const routeResult = await execPromise('route -n get default | grep gateway', { timeout: NETWORK_CONFIG.TIMEOUT_MS });
                const gatewayMatch = routeResult.stdout.match(/gateway: (.+)/);
                return gatewayMatch ? gatewayMatch[1].trim() : null;
            } catch (fallbackError) {
                return null;
            }
        }
    }

    /**
     * Handle network state changes and trigger essential notifications
     */
    private async handleNetworkStateChanges(): Promise<void> {
        if (!this.previousNetworkStatus) return;

        const prev = this.previousNetworkStatus;
        const curr = this.currentNetworkStatus;

        // Network disconnection
        if (prev.isOnline && !curr.isOnline) {
            await notifyNetworkDisconnected();
            
            // If shares were connected, notify about disconnection
            if (this.mountedShares.size > 0) {
                await notifySharesDisconnected(this.mountedShares.size);
            }
            
            this.emit('network-offline');
        }
        
        // Network reconnection
        else if (!prev.isOnline && curr.isOnline) {
            await notifyNetworkReconnected();
            this.emit('network-online');
            
            // Trigger auto-mount when network comes back online
            this.emit('auto-mount-requested');
        }
        
        // Internet connectivity lost (but still on network)
        else if (prev.hasInternet && !curr.hasInternet && curr.isOnline) {
            await notifyInternetLost();
            this.emit('internet-lost');
        }
        
        // Internet connectivity restored
        else if (!prev.hasInternet && curr.hasInternet && curr.isOnline) {
            await notifyInternetRestored();
            this.emit('internet-restored');
            
            // Trigger auto-mount when internet is restored
            this.emit('auto-mount-requested');
        }
        
        // Network changed (different WiFi/network)
        else if (prev.isOnline && curr.isOnline && prev.networkId && curr.networkId && 
                 prev.networkId !== curr.networkId) {
            await notifyNetworkChanged();
            this.emit('network-changed', { from: prev.networkId, to: curr.networkId });
        }
    }

    /**
     * **FAST NETWORK CHECK**: Immediate network connectivity check for instant user feedback
     * Used by tray "Open Folder" to get real-time network status without waiting for periodic checks
     */
    async checkNetworkConnectivity(): Promise<{isOnline: boolean, hasInternet: boolean}> {
        try {
            const isOnline = await this.isNetworkOnline();
            const hasInternet = isOnline ? await this.hasInternetConnectivity() : false;
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔄 Fast network check result: online=${isOnline}, internet=${hasInternet}`);
            }
            
            return { isOnline, hasInternet };
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('Fast network check failed:', error);
            }
            return { isOnline: false, hasInternet: false };
        }
    }

    /**
     * Get current network status
     */
    getNetworkStatus(): NetworkStatus {
        return { ...this.currentNetworkStatus };
    }

    /**
     * Get share monitoring service
     */
    getShareMonitoringService(): ShareMonitoringService {
        return this.shareMonitoringService;
    }

    /**
     * Add share to monitoring
     */
    addMountedShareToMonitoring(share: MountedShare): void {
        this.shareMonitoringService.addShareToMonitoring(share);
    }

    /**
     * Remove share from monitoring
     */
    removeMountedShareFromMonitoring(label: string): void {
        this.shareMonitoringService.removeShareFromMonitoring(label);
    }

    /**
     * Check if monitoring is active
     */
    isActive(): boolean {
        return this.shareMonitoringService.isActive();
    }

    /**
     * Perform auto-mount of saved connections when network becomes available
     */
    async performInitialAutoMount(): Promise<void> {
        // Import autoMountService - we'll pass it from main
        // This method will be called from main/index.ts with proper service reference
        this.emit('auto-mount-requested');
    }

    getPendingAutoMounts(): SavedConnection[] {
        return [];
    }

    getMountAttemptStats(): { connectionId: string; attempts: number; }[] {
        return [];
    }

    async forceRetryConnection(connectionId: string): Promise<void> {
        // Do nothing - no retry logic
    }

    async refreshNetworkStatus(): Promise<NetworkStatus> {
        return await this.checkNetworkStatus();
    }

    async forceShareReconnection(label: string): Promise<void> {
        // Do nothing - no reconnection logic
    }

    getMonitoringStatus(): any {
        return {
            network: this.getNetworkStatus(),
            shares: [],
            pendingMounts: [],
            mountAttempts: []
        };
    }

    getVPNStatus(): { isConnected: boolean; lastChecked: Date } {
        return { isConnected: false, lastChecked: new Date() };
    }
}

// Factory function
export function createNetworkWatcher(mountedShares: Map<string, MountedShare>): NetworkWatcher {
    return new NetworkWatcher(mountedShares);
}

/**
 * **FAST NETWORK CHECK EXPORT**: Standalone fast network check for immediate use
 * This allows other modules to quickly check network status without creating a full NetworkWatcher
 */
export async function checkNetworkConnectivity(): Promise<{isOnline: boolean, hasInternet: boolean}> {
    try {
        if (isDevelopment) console.log('🚀 [NetworkWatcher] Standalone network check starting...');
        const isOnlineResult = await customNetworkCheck(1000);
        if (isDevelopment) console.log('🚀 [NetworkWatcher] Standalone online check result:', isOnlineResult);
        
        if (!isOnlineResult) {
            return { isOnline: false, hasInternet: false };
        }
        
        // Quick internet check if network is online
        if (isDevelopment) console.log('🚀 [NetworkWatcher] Standalone internet check starting...');
        const hasInternetResult = await customNetworkCheck(1500);
        if (isDevelopment) console.log('🚀 [NetworkWatcher] Standalone internet check result:', hasInternetResult);
        
        return { isOnline: isOnlineResult, hasInternet: hasInternetResult };
    } catch (error) {
        if (isDevelopment) console.log('⚠️ [NetworkWatcher] Standalone custom check failed, using ping fallback:', error);
        // Fallback to ping-based check
        try {
            if (isDevelopment) console.log('🏓 [NetworkWatcher] Standalone ping fallback for online check...');
            const isOnlinePromise = execPromise('ping -c 1 -W 500 8.8.8.8', { timeout: 1000 })
                .then(() => {
                    if (isDevelopment) console.log('✅ [NetworkWatcher] Standalone ping online successful');
                    return true;
                })
                .catch(() => {
                    if (isDevelopment) console.log('❌ [NetworkWatcher] Standalone ping online failed');
                    return false;
                });
                
            const isOnline = await isOnlinePromise;
            
            if (!isOnline) {
                return { isOnline: false, hasInternet: false };
            }
            
            if (isDevelopment) console.log('🏓 [NetworkWatcher] Standalone ping fallback for internet check...');
            const hasInternetPromise = execPromise('ping -c 1 -W 1000 1.1.1.1', { timeout: 1500 })
                .then(() => {
                    if (isDevelopment) console.log('✅ [NetworkWatcher] Standalone ping internet successful');
                    return true;
                })
                .catch(() => {
                    if (isDevelopment) console.log('❌ [NetworkWatcher] Standalone ping internet failed');
                    return false;
                });
                
            const hasInternet = await hasInternetPromise;
            
            return { isOnline, hasInternet };
        } catch (fallbackError) {
            return { isOnline: false, hasInternet: false };
        }
    }
}
