// src/main/utils/shareMonitoringService.ts
// Minimal network monitoring to prevent app hanging when WiFi disconnects

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { unmountSMBShare } from '../mount/smbService';
import { MountedShare } from '../../types';
import { notifySharesDisconnected } from './essentialNotifications';

const execPromise = promisify(exec);

export class ShareMonitoringService extends EventEmitter {
    private mountedShares: Map<string, MountedShare>;
    private isMonitoring = false;
    private networkCheckInterval: NodeJS.Timeout | null = null;
    
    // Minimal configuration - just prevent hanging
    private readonly NETWORK_CHECK_INTERVAL = 15000; // Check every 15 seconds
    private readonly DISCONNECT_TIMEOUT = 2000; // Quick timeout to prevent hanging

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        super();
        this.mountedShares = mountedSharesRef;
    }

    /**
     * Start minimal monitoring - just check network and disconnect shares if needed
     */
    async start(): Promise<void> {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        
        // Simple network check - if network is down, safely disconnect shares
        this.networkCheckInterval = setInterval(() => {
            this.checkNetworkAndDisconnectIfNeeded();
        }, this.NETWORK_CHECK_INTERVAL);

        if (process.env.NODE_ENV === 'development') {
            console.log('📊 Minimal ShareMonitoringService started');
        }
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;

        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
        }

        if (process.env.NODE_ENV === 'development') {
            console.log('🛑 ShareMonitoringService stopped');
        }
    }

    /**
     * Check if network is available and disconnect shares if not
     */
    private async checkNetworkAndDisconnectIfNeeded(): Promise<void> {
        try {
            // Quick network check with short timeout
            const isOnline = await this.isNetworkAvailable();
            
            if (!isOnline && this.mountedShares.size > 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('🔴 Network unavailable, safely disconnecting shares to prevent hanging');
                }
                await this.safelyDisconnectAllShares();
            }
        } catch (error) {
            // If check fails, assume network issues and disconnect
            if (this.mountedShares.size > 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('⚠️ Network check failed, disconnecting shares as precaution');
                }
                await this.safelyDisconnectAllShares();
            }
        }
    }

    /**
     * Quick network availability check
     */
    private async isNetworkAvailable(): Promise<boolean> {
        try {
            // Simple ping to check network
            await execPromise('ping -c 1 -W 2000 8.8.8.8', { timeout: 3000 });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Safely disconnect all shares with timeout to prevent hanging
     */
    private async safelyDisconnectAllShares(): Promise<void> {
        const shareLabels = Array.from(this.mountedShares.keys());
        
        if (shareLabels.length === 0) return;
        
        // Notify user about disconnection
        await notifySharesDisconnected(shareLabels.length);
        
        for (const label of shareLabels) {
            const share = this.mountedShares.get(label);
            if (!share) continue;

            try {
                // Force unmount with very short timeout
                await Promise.race([
                    unmountSMBShare(share.mountPoint),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Disconnect timeout')), this.DISCONNECT_TIMEOUT)
                    )
                ]);

                this.mountedShares.delete(label);
                
                if (process.env.NODE_ENV === 'development') {
                    console.log(`✅ Safely disconnected: ${label}`);
                }

            } catch (error) {
                // Even if unmount fails, remove from tracking to prevent UI issues
                this.mountedShares.delete(label);
                
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⚠️ Force removed from tracking: ${label}`);
                }
            }
        }

        this.emit('shares-disconnected', shareLabels);
    }

    /**
     * Add a share to monitoring (minimal tracking)
     */
    addShareToMonitoring(share: MountedShare): void {
        // Just emit event, no complex tracking
        this.emit('share-added', share);
    }

    /**
     * Remove a share from monitoring
     */
    removeShareFromMonitoring(label: string): void {
        this.emit('share-removed', label);
    }

    /**
     * Force health check - minimal implementation
     */
    async forceHealthCheck(label: string): Promise<void> {
        await this.checkNetworkAndDisconnectIfNeeded();
    }

    /**
     * Check if monitoring is active
     */
    isActive(): boolean {
        return this.isMonitoring;
    }

    /**
     * Get empty statuses (for compatibility)
     */
    getShareStatuses(): Map<string, any> {
        return new Map();
    }
}

// Factory function
export function createShareMonitoringService(mountedShares: Map<string, MountedShare>): ShareMonitoringService {
    return new ShareMonitoringService(mountedShares);
}
