// src/main/utils/networkWatcher.ts
// Advanced network monitoring and auto-mount service for handling network changes, 
// app restarts, system restarts, and user logouts

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { connectionStore, SavedConnection } from './connectionStore';
import { mountSMBShare, isMountPointAccessible, isMountPoint } from '../mount/smbService';
import { MountedShare } from '../../types';
import { 
    notifyNetworkLoss, 
    notifyNetworkRestored,
    notifyAutoMountSuccess,
    notifyMountFailure 
} from './networkNotifications';

const execPromise = promisify(exec);

export interface NetworkStatus {
    isOnline: boolean;
    hasNetworkConnectivity: boolean;
    canReachGateway: boolean;
    lastChecked: Date;
}

export interface AutoMountAttempt {
    connection: SavedConnection;
    success: boolean;
    mountPoint?: string;
    error?: string;
    timestamp: Date;
    attemptNumber: number;
}

export class NetworkWatcher extends EventEmitter {
    private mountedShares: Map<string, MountedShare>;
    private networkCheckInterval: NodeJS.Timeout | null = null;
    private autoMountRetryInterval: NodeJS.Timeout | null = null;
    private currentNetworkStatus: NetworkStatus;
    private pendingAutoMounts: Set<string> = new Set(); // Track connections waiting to be mounted
    private mountAttempts: Map<string, number> = new Map(); // Track retry attempts per connection
    private lastSuccessfulMount: Map<string, Date> = new Map(); // Track last successful mount times
    
    // Configuration
    private readonly NETWORK_CHECK_INTERVAL = 15000; // Check network every 15 seconds
    private readonly AUTO_MOUNT_RETRY_INTERVAL = 30000; // Retry failed auto-mounts every 30 seconds
    private readonly MAX_RETRY_ATTEMPTS = 5; // Maximum retry attempts per connection
    private readonly RETRY_BACKOFF_MULTIPLIER = 1.5; // Exponential backoff multiplier
    private readonly MIN_RETRY_DELAY = 10000; // Minimum delay between retries (10 seconds)
    private readonly MAX_RETRY_DELAY = 300000; // Maximum delay between retries (5 minutes)

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        super();
        this.mountedShares = mountedSharesRef;
        this.currentNetworkStatus = {
            isOnline: false,
            hasNetworkConnectivity: false,
            canReachGateway: false,
            lastChecked: new Date()
        };
    }

    // Start the network monitoring service
    async start(): Promise<void> {
        if (process.env.NODE_ENV === 'development') {
            console.log('🌐 Starting NetworkWatcher service...');
        }
        
        // Initial network check and auto-mount
        await this.checkNetworkStatus();
        await this.performInitialAutoMount();
        
        // Start periodic network monitoring
        this.networkCheckInterval = setInterval(() => {
            this.checkNetworkStatus();
        }, this.NETWORK_CHECK_INTERVAL);
        
        // Start periodic auto-mount retry for failed connections
        this.autoMountRetryInterval = setInterval(() => {
            this.retryFailedAutoMounts();
        }, this.AUTO_MOUNT_RETRY_INTERVAL);
        
        if (process.env.NODE_ENV === 'development') {
            console.log('✅ NetworkWatcher service started');
        }
    }

    // Stop the network monitoring service
    stop(): void {
        if (process.env.NODE_ENV === 'development') {
            console.log('🛑 Stopping NetworkWatcher service...');
        }
        
        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
        }
        
        if (this.autoMountRetryInterval) {
            clearInterval(this.autoMountRetryInterval);
            this.autoMountRetryInterval = null;
        }
        
        this.pendingAutoMounts.clear();
        this.mountAttempts.clear();
        
        if (process.env.NODE_ENV === 'development') {
            console.log('✅ NetworkWatcher service stopped');
        }
    }

    // Check current network status
    async checkNetworkStatus(): Promise<NetworkStatus> {
        const previousStatus = { ...this.currentNetworkStatus };
        
        try {
            // Check basic connectivity
            const isOnline = await this.isNetworkOnline();
            const hasNetworkConnectivity = await this.hasInternetConnectivity();
            const canReachGateway = await this.canReachDefaultGateway();
            
            this.currentNetworkStatus = {
                isOnline,
                hasNetworkConnectivity,
                canReachGateway,
                lastChecked: new Date()
            };
            
            // Emit events for network status changes
            if (previousStatus.isOnline !== isOnline) {
                if (isOnline) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🟢 Network connection established');
                    }
                    this.emit('network-online');
                    // Notify user of network restoration
                    notifyNetworkRestored();
                    // Trigger auto-mount when network comes back online
                    await this.handleNetworkReconnection();
                } else {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🔴 Network connection lost');
                    }
                    this.emit('network-offline');
                    // Notify user of network loss
                    notifyNetworkLoss();
                }
            }
            
            if (previousStatus.hasNetworkConnectivity !== hasNetworkConnectivity) {
                if (hasNetworkConnectivity) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🌐 Internet connectivity restored');
                    }
                    this.emit('internet-available');
                } else {
                    if (process.env.NODE_ENV === 'development') {
                        console.log('🚫 Internet connectivity lost');
                    }
                    this.emit('internet-unavailable');
                }
            }
            
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('⚠️ Error checking network status:', error);
            }
            this.currentNetworkStatus.isOnline = false;
            this.currentNetworkStatus.hasNetworkConnectivity = false;
            this.currentNetworkStatus.canReachGateway = false;
        }
        
        return this.currentNetworkStatus;
    }

    // Check if network interface is up
    private async isNetworkOnline(): Promise<boolean> {
        try {
            // Check if we have any active network interfaces
            const result = await execPromise('ifconfig | grep "inet " | grep -v "127.0.0.1"', { timeout: 5000 });
            return result.stdout.trim().length > 0;
        } catch (error) {
            return false;
        }
    }

    // Check if we can reach the internet
    private async hasInternetConnectivity(): Promise<boolean> {
        try {
            // Try to reach a reliable DNS server (Google's 8.8.8.8)
            await execPromise('ping -c 1 -W 2000 8.8.8.8', { timeout: 5000 });
            return true;
        } catch (error) {
            return false;
        }
    }

    // Check if we can reach the default gateway
    private async canReachDefaultGateway(): Promise<boolean> {
        try {
            // Get default gateway
            const routeResult = await execPromise('route -n get default', { timeout: 3000 });
            const gatewayMatch = routeResult.stdout.match(/gateway: (.+)/);
            
            if (!gatewayMatch) {
                return false;
            }
            
            const gateway = gatewayMatch[1].trim();
            
            // Ping the gateway
            await execPromise(`ping -c 1 -W 2000 ${gateway}`, { timeout: 5000 });
            return true;
        } catch (error) {
            return false;
        }
    }

    // Perform initial auto-mount on app startup
    async performInitialAutoMount(): Promise<void> {
        if (process.env.NODE_ENV === 'development') {
            console.log('🚀 Performing initial auto-mount check...');
        }
        
        if (!this.currentNetworkStatus.isOnline) {
            if (process.env.NODE_ENV === 'development') {
                console.log('⏸️ Network not available, delaying auto-mount');
            }
            return;
        }

        const autoMountConnections = connectionStore.getAutoMountConnections();
        if (process.env.NODE_ENV === 'development') {
            console.log(`📂 Found ${autoMountConnections.length} connections configured for auto-mount`);
        }

        for (const connection of autoMountConnections) {
            // Check if already mounted
            if (this.isConnectionCurrentlyMounted(connection)) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`✅ ${connection.label} is already mounted`);
                }
                continue;
            }

            // Add to pending auto-mounts
            this.pendingAutoMounts.add(connection.id);
            
            // Attempt mount with delay to avoid overwhelming the network
            setTimeout(() => {
                this.attemptAutoMount(connection);
            }, Math.random() * 5000); // Random delay 0-5 seconds
        }
    }

    // Handle network reconnection
    private async handleNetworkReconnection(): Promise<void> {
        if (process.env.NODE_ENV === 'development') {
            console.log('🔄 Network reconnected, checking mounts and retrying failed connections...');
        }
        
        // Wait a bit for network to stabilize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Re-validate existing mounts
        await this.validateExistingMounts();
        
        // Retry any pending auto-mounts
        const autoMountConnections = connectionStore.getAutoMountConnections();
        for (const connection of autoMountConnections) {
            if (!this.isConnectionCurrentlyMounted(connection)) {
                this.pendingAutoMounts.add(connection.id);
                // Reset retry count on network reconnection
                this.mountAttempts.delete(connection.id);
            }
        }
    }

    // Validate existing mounts and remove disconnected ones
    private async validateExistingMounts(): Promise<void> {
        const disconnectedShares: string[] = [];
        
        for (const [label, share] of this.mountedShares.entries()) {
            const isAccessible = await isMountPointAccessible(share.mountPoint);
            const isStillMounted = await isMountPoint(share.mountPoint);
            
            if (!isAccessible || !isStillMounted) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`❌ Share ${label} is no longer accessible, removing from tracking`);
                }
                disconnectedShares.push(label);
                
                // Find the connection and add it back to pending auto-mounts
                const connections = connectionStore.getConnections();
                const connection = connections.find(conn => 
                    conn.sharePath === share.sharePath && 
                    conn.username === share.username && 
                    conn.autoMount
                );
                
                if (connection) {
                    this.pendingAutoMounts.add(connection.id);
                    // Reset retry count since this was previously working
                    this.mountAttempts.delete(connection.id);
                }
            }
        }
        
        // Remove disconnected shares from tracking
        for (const label of disconnectedShares) {
            this.mountedShares.delete(label);
        }
        
        if (disconnectedShares.length > 0) {
            this.emit('mounts-validated', disconnectedShares);
        }
    }

    // Attempt to auto-mount a specific connection
    private async attemptAutoMount(connection: SavedConnection): Promise<AutoMountAttempt> {
        const attemptNumber = (this.mountAttempts.get(connection.id) || 0) + 1;
        this.mountAttempts.set(connection.id, attemptNumber);
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`🔄 Auto-mount attempt ${attemptNumber} for ${connection.label}`);
        }
        
        const attempt: AutoMountAttempt = {
            connection,
            success: false,
            timestamp: new Date(),
            attemptNumber
        };

        try {
            // Check if already mounted
            if (this.isConnectionCurrentlyMounted(connection)) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`✅ ${connection.label} is already mounted`);
                }
                this.pendingAutoMounts.delete(connection.id);
                this.mountAttempts.delete(connection.id);
                attempt.success = true;
                return attempt;
            }

            // Get password from keychain
            const password = await connectionStore.getPassword(connection.id);
            if (!password) {
                throw new Error('Password not found in keychain');
            }

            // Attempt to mount
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

            // Update connection usage
            await connectionStore.updateConnectionUsage(connection.id);

            // Mark as successful
            this.pendingAutoMounts.delete(connection.id);
            this.mountAttempts.delete(connection.id);
            this.lastSuccessfulMount.set(connection.id, new Date());

            attempt.success = true;
            attempt.mountPoint = mountPoint;

            if (process.env.NODE_ENV === 'development') {
                console.log(`✅ Auto-mounted: ${connection.label} -> ${mountPoint}`);
            }
            // Notify user of successful auto-mount
            notifyAutoMountSuccess(1);
            this.emit('mount-success', { connection, mountPoint });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Auto-mount attempt ${attemptNumber} failed for ${connection.label}: ${errorMessage}`);
            }
            
            attempt.error = errorMessage;
            
            // Check if we should retry
            if (attemptNumber >= this.MAX_RETRY_ATTEMPTS) {
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`🚫 Max retry attempts reached for ${connection.label}, removing from auto-mount queue`);
                }
                this.pendingAutoMounts.delete(connection.id);
                this.mountAttempts.delete(connection.id);
                // Notify user of permanent mount failure
                notifyMountFailure(connection.label, `Maximum retry attempts (${this.MAX_RETRY_ATTEMPTS}) reached. Auto-mount disabled for this session.`);
                this.emit('mount-failed-permanently', { connection, error: errorMessage });
            } else {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⏳ Will retry ${connection.label} in next cycle`);
                }
                // For temporary failures, we could show a less prominent notification
                // but let's avoid spam by only notifying on final failure
            }
        }

        return attempt;
    }

    // Retry failed auto-mounts with exponential backoff
    private async retryFailedAutoMounts(): Promise<void> {
        if (this.pendingAutoMounts.size === 0) {
            return;
        }

        if (!this.currentNetworkStatus.isOnline) {
            if (process.env.NODE_ENV === 'development') {
                console.log('⏸️ Network offline, skipping auto-mount retry');
            }
            return;
        }

        if (process.env.NODE_ENV === 'development') {
            console.log(`🔄 Retrying ${this.pendingAutoMounts.size} pending auto-mounts...`);
        }

        for (const connectionId of this.pendingAutoMounts) {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                this.pendingAutoMounts.delete(connectionId);
                continue;
            }

            const attemptNumber = this.mountAttempts.get(connectionId) || 0;
            
            // Calculate backoff delay
            const baseDelay = this.MIN_RETRY_DELAY;
            const backoffDelay = Math.min(
                baseDelay * Math.pow(this.RETRY_BACKOFF_MULTIPLIER, attemptNumber - 1),
                this.MAX_RETRY_DELAY
            );

            // Check if enough time has passed since last attempt
            const lastAttemptTime = this.lastSuccessfulMount.get(connectionId);
            if (lastAttemptTime) {
                const timeSinceLastAttempt = Date.now() - lastAttemptTime.getTime();
                if (timeSinceLastAttempt < backoffDelay) {
                    continue; // Wait longer before retrying
                }
            }

            // Attempt the mount
            setTimeout(() => {
                this.attemptAutoMount(connection);
            }, Math.random() * 2000); // Small random delay to avoid thundering herd
        }
    }

    // Check if a connection is currently mounted
    private isConnectionCurrentlyMounted(connection: SavedConnection): boolean {
        return Array.from(this.mountedShares.values()).some(
            share => share.sharePath === connection.sharePath && 
                     share.username === connection.username
        );
    }

    // Get current network status
    getNetworkStatus(): NetworkStatus {
        return { ...this.currentNetworkStatus };
    }

    // Get pending auto-mount connections
    getPendingAutoMounts(): SavedConnection[] {
        const connections = connectionStore.getConnections();
        return connections.filter(conn => this.pendingAutoMounts.has(conn.id));
    }

    // Get mount attempt statistics
    getMountAttemptStats(): { connectionId: string; attempts: number; }[] {
        return Array.from(this.mountAttempts.entries()).map(([connectionId, attempts]) => ({
            connectionId,
            attempts
        }));
    }

    // Force retry a specific connection
    async forceRetryConnection(connectionId: string): Promise<void> {
        const connection = await connectionStore.getConnection(connectionId);
        if (!connection) {
            throw new Error(`Connection not found: ${connectionId}`);
        }

        // Reset attempt counter
        this.mountAttempts.delete(connectionId);
        this.pendingAutoMounts.add(connectionId);
        
        // Attempt mount immediately
        await this.attemptAutoMount(connection);
    }

    // Manually trigger network status check
    async refreshNetworkStatus(): Promise<NetworkStatus> {
        return await this.checkNetworkStatus();
    }
}

// Factory function to create NetworkWatcher instance
export function createNetworkWatcher(mountedShares: Map<string, MountedShare>): NetworkWatcher {
    return new NetworkWatcher(mountedShares);
}
