// src/main/utils/networkWatcher.ts
// Minimal network monitoring to prevent app hanging

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { connectionStore, SavedConnection } from './connectionStore';
import { MountedShare } from '../../types';
import { createShareMonitoringService, ShareMonitoringService } from './shareMonitoringService';
import { 
    notifyNetworkDisconnected, 
    notifyNetworkReconnected, 
    notifyInternetLost, 
    notifyInternetRestored,
    notifyNetworkChanged,
    notifySharesDisconnected 
} from './essentialNotifications';

const execPromise = promisify(exec);

export interface NetworkStatus {
    isOnline: boolean;
    hasInternet: boolean;
    networkId: string | null; // To detect network changes
    lastChecked: Date;
}

export class NetworkWatcher extends EventEmitter {
    private mountedShares: Map<string, MountedShare>;
    private shareMonitoringService: ShareMonitoringService;
    private networkCheckInterval: NodeJS.Timeout | null = null;
    private currentNetworkStatus: NetworkStatus;
    private previousNetworkStatus: NetworkStatus | null = null;
    
    // Minimal configuration with faster network status updates
    private readonly NETWORK_CHECK_INTERVAL = 5000; // Check every 5 seconds for faster user feedback

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
        }, this.NETWORK_CHECK_INTERVAL);

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
     * Quick network check with very short timeout for fast user feedback
     */
    private async isNetworkOnline(): Promise<boolean> {
        try {
            // Ultra-fast ping with minimal timeout for quick status updates
            await execPromise('ping -c 1 -W 500 8.8.8.8', { timeout: 1000 });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check internet connectivity (different from just network connectivity)
     */
    private async hasInternetConnectivity(): Promise<boolean> {
        try {
            // Quick internet check with reduced timeout
            await execPromise('ping -c 1 -W 1000 1.1.1.1', { timeout: 1500 });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get current network identifier to detect network changes (optimized for speed)
     */
    private async getCurrentNetworkId(): Promise<string | null> {
        try {
            // Get current WiFi network name (SSID) on macOS with faster timeout
            const result = await execPromise('networksetup -getairportnetwork en0', { timeout: 1000 });
            const match = result.stdout.match(/Current Wi-Fi Network: (.+)/);
            return match ? match[1].trim() : null;
        } catch (error) {
            // Fall back to router/gateway IP as network identifier with faster timeout
            try {
                const routeResult = await execPromise('route -n get default | grep gateway', { timeout: 1000 });
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
