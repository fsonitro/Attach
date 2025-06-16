// src/main/utils/shareMonitoringService.ts
// Enhanced network monitoring with intelligent reconnection and retry logic

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { unmountSMBShare, quickConnectivityCheck } from '../mount/smbService';
import { MountedShare } from '../../types';
import { notifySharesDisconnected, notifySharesReconnected } from './essentialNotifications';
import { connectionStore, SavedConnection } from './connectionStore';
import { reliableNetworkCheck } from './networkUtils';

const execPromise = promisify(exec);

// Enhanced interfaces with better type safety
interface RetryEntry {
    connection: SavedConnection;
    attempts: number;
    lastAttempt: Date;
    nextAttempt: Date;
    backoffDelay: number;
}

interface ShareAvailabilityCheck {
    serverId: string;
    lastCheck: Date;
    isAvailable: boolean;
    consecutiveFailures: number;
}

// Configuration constants
const MONITORING_CONFIG = {
    NETWORK_CHECK_INTERVAL: 10000,      // Check every 10 seconds
    DISCONNECT_TIMEOUT: 2000,           // Quick timeout to prevent hanging
    RETRY_CHECK_INTERVAL: 30000,        // Check retry queue every 30 seconds
    AVAILABILITY_CHECK_INTERVAL: 45000, // Check share availability every 45 seconds
    MAX_RETRY_ATTEMPTS: 8,              // Maximum retry attempts
    MIN_BACKOFF_DELAY: 30000,           // 30 seconds minimum delay
    MAX_BACKOFF_DELAY: 300000,          // 5 minutes maximum delay
    BACKOFF_MULTIPLIER: 1.5             // Exponential backoff multiplier
} as const;

export class ShareMonitoringService extends EventEmitter {
    private readonly mountedShares: Map<string, MountedShare>;
    private isMonitoring = false;
    private networkCheckInterval: NodeJS.Timeout | null = null;
    private retryQueue: Map<string, RetryEntry> = new Map();
    private shareAvailability: Map<string, ShareAvailabilityCheck> = new Map();
    private retryCheckInterval: NodeJS.Timeout | null = null;
    private availabilityCheckInterval: NodeJS.Timeout | null = null;

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        super();
        this.mountedShares = mountedSharesRef;
    }

    /**
     * Start enhanced monitoring with intelligent reconnection
     */
    async start(): Promise<void> {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        
        // Enhanced network check with retry logic
        this.networkCheckInterval = setInterval(() => {
            this.checkNetworkAndHandleShares();
        }, MONITORING_CONFIG.NETWORK_CHECK_INTERVAL);

        // Start retry queue processing
        this.retryCheckInterval = setInterval(() => {
            this.processRetryQueue();
        }, MONITORING_CONFIG.RETRY_CHECK_INTERVAL);

        // Start share availability checking
        this.availabilityCheckInterval = setInterval(() => {
            this.checkShareAvailability();
        }, MONITORING_CONFIG.AVAILABILITY_CHECK_INTERVAL);

        if (process.env.NODE_ENV === 'development') {
            console.log('📊 Enhanced ShareMonitoringService started with intelligent reconnection');
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

        if (this.retryCheckInterval) {
            clearInterval(this.retryCheckInterval);
            this.retryCheckInterval = null;
        }

        if (this.availabilityCheckInterval) {
            clearInterval(this.availabilityCheckInterval);
            this.availabilityCheckInterval = null;
        }

        // Clear retry queue
        this.retryQueue.clear();
        this.shareAvailability.clear();

        if (process.env.NODE_ENV === 'development') {
            console.log('🛑 Enhanced ShareMonitoringService stopped');
        }
    }

    /**
     * Enhanced network check with intelligent share handling
     */
    private async checkNetworkAndHandleShares(): Promise<void> {
        try {
            const isOnline = await this.isNetworkAvailable();
            
            if (!isOnline && this.mountedShares.size > 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('🔴 Network unavailable, safely disconnecting shares');
                }
                await this.safelyDisconnectAllShares();
            } else if (isOnline) {
                // Network is available, check if we can reconnect any failed shares
                await this.attemptReconnections();
            }
        } catch (error) {
            if (this.mountedShares.size > 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('⚠️ Network check failed, disconnecting shares as precaution');
                }
                await this.safelyDisconnectAllShares();
            }
        }
    }

    /**
     * Process the retry queue for failed mounts
     */
    private async processRetryQueue(): Promise<void> {
        const now = new Date();
        const reconnectedShares: string[] = [];

        for (const [connectionId, retryEntry] of this.retryQueue.entries()) {
            if (now >= retryEntry.nextAttempt) {
                if (retryEntry.attempts >= MONITORING_CONFIG.MAX_RETRY_ATTEMPTS) {
                    // Max attempts reached, remove from queue
                    this.retryQueue.delete(connectionId);
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🚫 Max retry attempts reached for ${retryEntry.connection.label}`);
                    }
                    continue;
                }

                // Attempt to reconnect
                const success = await this.attemptShareReconnection(retryEntry.connection);
                if (success) {
                    reconnectedShares.push(retryEntry.connection.label);
                    this.retryQueue.delete(connectionId);
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`✅ Successfully reconnected ${retryEntry.connection.label}`);
                    }
                } else {
                    // Update retry entry with exponential backoff
                    retryEntry.attempts++;
                    retryEntry.lastAttempt = now;
                    retryEntry.backoffDelay = Math.min(
                        retryEntry.backoffDelay * MONITORING_CONFIG.BACKOFF_MULTIPLIER,
                        MONITORING_CONFIG.MAX_BACKOFF_DELAY
                    );
                    retryEntry.nextAttempt = new Date(now.getTime() + retryEntry.backoffDelay);
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔄 Retry ${retryEntry.attempts}/${MONITORING_CONFIG.MAX_RETRY_ATTEMPTS} for ${retryEntry.connection.label} scheduled for ${retryEntry.nextAttempt.toLocaleTimeString()}`);
                    }
                }
            }
        }

        // Notify about successful reconnections
        if (reconnectedShares.length > 0) {
            await notifySharesReconnected(reconnectedShares.length);
            this.emit('shares-reconnected', reconnectedShares);
        }
    }

    /**
     * Check availability of servers that had failed connections
     */
    private async checkShareAvailability(): Promise<void> {
        const now = new Date();

        for (const [serverId, check] of this.shareAvailability.entries()) {
            // Check servers that were previously unavailable
            if (!check.isAvailable) {
                try {
                    const connectivityResult = await quickConnectivityCheck(serverId, 3000);
                    if (connectivityResult.accessible) {
                        check.isAvailable = true;
                        check.consecutiveFailures = 0;
                        check.lastCheck = now;
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`🟢 Server ${serverId} is now available`);
                        }
                        
                        // Trigger retry for any connections to this server
                        this.triggerServerRetries(serverId);
                    } else {
                        check.consecutiveFailures++;
                        check.lastCheck = now;
                    }
                } catch (error) {
                    check.consecutiveFailures++;
                    check.lastCheck = now;
                }
            }
        }
    }

    /**
     * Attempt to reconnect a specific share
     */
    private async attemptShareReconnection(connection: SavedConnection): Promise<boolean> {
        try {
            // Check server connectivity first
            const serverName = this.extractServerName(connection.sharePath);
            const connectivityResult = await quickConnectivityCheck(serverName, 5000);
            
            if (!connectivityResult.accessible) {
                // Update availability tracking
                this.updateShareAvailability(serverName, false);
                return false;
            }

            // Server is reachable, try to mount
            const { mountSMBShare } = require('../mount/smbService');
            const password = await connectionStore.getPassword(connection.id);
            
            if (!password) {
                throw new Error('Password not found');
            }

            const mountPoint = await mountSMBShare(
                connection.sharePath,
                connection.username,
                password
            );

            // Create mounted share entry
            const mountedShare: MountedShare = {
                label: connection.label,
                mountPoint,
                sharePath: connection.sharePath,
                username: connection.username,
                mountedAt: new Date()
            };

            // Add to mounted shares map
            this.mountedShares.set(connection.label, mountedShare);
            this.updateShareAvailability(serverName, true);
            
            this.emit('share-reconnected', mountedShare);
            return true;

        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`❌ Failed to reconnect ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            // Update availability tracking
            const serverName = this.extractServerName(connection.sharePath);
            this.updateShareAvailability(serverName, false);
            return false;
        }
    }

    /**
     * Attempt reconnections for shares that should be auto-mounted
     */
    private async attemptReconnections(): Promise<void> {
        try {
            // Get auto-mount connections that aren't currently mounted
            const autoMountConnections = await connectionStore.getAutoMountConnections();
            const currentlyMounted = new Set(Array.from(this.mountedShares.values()).map(s => s.sharePath));
            
            for (const connection of autoMountConnections) {
                if (!currentlyMounted.has(connection.sharePath) && !this.retryQueue.has(connection.id)) {
                    // Add to retry queue if not already present
                    this.addToRetryQueue(connection);
                }
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('Failed to check for reconnection opportunities:', error);
            }
        }
    }

    /**
     * Add a connection to the retry queue
     */
    addToRetryQueue(connection: SavedConnection): void {
        const now = new Date();
        const retryEntry: RetryEntry = {
            connection,
            attempts: 0,
            lastAttempt: now,
            nextAttempt: new Date(now.getTime() + MONITORING_CONFIG.MIN_BACKOFF_DELAY),
            backoffDelay: MONITORING_CONFIG.MIN_BACKOFF_DELAY
        };

        this.retryQueue.set(connection.id, retryEntry);
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔄 Added ${connection.label} to retry queue`);
        }
    }

    /**
     * Update share availability tracking
     */
    private updateShareAvailability(serverId: string, isAvailable: boolean): void {
        const existing = this.shareAvailability.get(serverId);
        if (existing) {
            existing.isAvailable = isAvailable;
            existing.lastCheck = new Date();
            if (!isAvailable) {
                existing.consecutiveFailures++;
            } else {
                existing.consecutiveFailures = 0;
            }
        } else {
            this.shareAvailability.set(serverId, {
                serverId,
                lastCheck: new Date(),
                isAvailable,
                consecutiveFailures: isAvailable ? 0 : 1
            });
        }
    }

    /**
     * Trigger retries for all connections to a specific server
     */
    private triggerServerRetries(serverId: string): void {
        for (const [connectionId, retryEntry] of this.retryQueue.entries()) {
            const connectionServerId = this.extractServerName(retryEntry.connection.sharePath);
            if (connectionServerId === serverId) {
                // Reset the next attempt time to now for immediate retry
                retryEntry.nextAttempt = new Date();
            }
        }
    }

    /**
     * Extract server name from share path
     */
    private extractServerName(sharePath: string): string {
        return sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').split('/')[0];
    }

    /**
     * Quick network availability check using reliable DNS/HTTPS method
     */
    private async isNetworkAvailable(): Promise<boolean> {
        try {
            // Use reliable network check with DNS/HTTPS and ping fallback
            return await reliableNetworkCheck(3000);
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
                        setTimeout(() => reject(new Error('Disconnect timeout')), MONITORING_CONFIG.DISCONNECT_TIMEOUT)
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
        await this.checkNetworkAndHandleShares();
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
