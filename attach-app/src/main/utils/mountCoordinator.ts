// src/main/utils/mountCoordinator.ts
// Global mount operation coordinator to prevent race conditions and duplicate mounts

import { SavedConnection } from './connectionStore';
import * as os from 'os';

// Helper function to get current username dynamically
function getCurrentUsername(): string {
    try {
        return os.userInfo().username;
    } catch (error) {
        // Fallback to environment variable if os.userInfo() fails
        return process.env.USER || process.env.USERNAME || 'user';
    }
}

// Enhanced interfaces with better type safety
interface MountOperation {
    connectionId: string;
    sharePath: string;
    trigger: string;
    startTime: number;
    promise: Promise<any>;
}

interface CoordinatorStats {
    readonly activeOperations: number;
    readonly queuedOperations: number;
    readonly longestRunningOperation?: {
        readonly connectionLabel: string;
        readonly duration: number;
        readonly trigger: string;
    };
}

// Enhanced conflict detection result
interface SystemMountCheck {
    readonly hasSystemMount: boolean;
    readonly mountDetails?: {
        readonly mountPoint: string;
        readonly serverPath: string;
        readonly isAppManaged: boolean;
    };
    readonly conflictResolved: boolean;
    readonly error?: string;
}

// Configuration constants
const COORDINATOR_CONFIG = {
    MAX_OPERATION_TIME: 60000,        // 60 seconds maximum operation time
    CLEANUP_INTERVAL: 30000,          // Clean up stale operations every 30 seconds
    QUEUE_PROCESSING_DELAY: 100,      // Small delay between queue processing
    CONFLICT_RESOLUTION_TIMEOUT: 10000 // 10 seconds timeout for conflict resolution
} as const;

export class MountCoordinator {
    private static instance: MountCoordinator;
    private activeMounts: Map<string, MountOperation> = new Map();
    private mountQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue = false;

    private constructor() {}

    static getInstance(): MountCoordinator {
        if (!MountCoordinator.instance) {
            MountCoordinator.instance = new MountCoordinator();
        }
        return MountCoordinator.instance;
    }

    // Check if a mount operation is already in progress for this connection
    isMountInProgress(connection: SavedConnection): boolean {
        const key = this.getMountKey(connection);
        return this.activeMounts.has(key);
    }

    // Get the mount operation details if one is in progress
    getMountOperation(connection: SavedConnection): MountOperation | undefined {
        const key = this.getMountKey(connection);
        return this.activeMounts.get(key);
    }

    // Check if a connection conflicts with existing system mounts (without resolving)
    async hasSystemMountConflict(connection: SavedConnection): Promise<boolean> {
        try {
            const { detectMountConflict } = await import('../mount/smbService');
            const conflictCheck = await detectMountConflict(connection.sharePath);
            return conflictCheck.hasConflict;
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.warn(`Error checking for system mount conflicts: ${error}`);
            }
            return false;
        }
    }

    // Coordinate a mount operation to prevent duplicates and handle system mount conflicts
    async coordinateMount<T>(
        connection: SavedConnection,
        trigger: string,
        mountFunction: () => Promise<T>
    ): Promise<T> {
        const key = this.getMountKey(connection);
        
        // Check if mount is already in progress
        const existingOperation = this.activeMounts.get(key);
        if (existingOperation) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`🔄 Mount already in progress for ${connection.label} (started by ${existingOperation.trigger}), waiting...`);
            }
            // Wait for the existing operation to complete
            try {
                return await existingOperation.promise;
            } catch (error) {
                // If the existing operation failed, we'll proceed with our own attempt
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⚠️ Previous mount attempt failed for ${connection.label}, proceeding with new attempt`);
                }
            }
        }

        // **NEW: Check for system mount conflicts before proceeding**
        const systemMountCheck = await this.checkAndResolveSystemMountConflicts(connection);
        if (systemMountCheck.hasSystemMount && !systemMountCheck.conflictResolved) {
            const errorMessage = `Share is already mounted by the system at ${systemMountCheck.mountDetails?.mountPoint}. ${systemMountCheck.error || 'Could not resolve automatically.'}`;
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ System mount conflict for ${connection.label}: ${errorMessage}`);
            }
            throw new Error(errorMessage);
        }

        // Create new mount operation
        const operation: Partial<MountOperation> = {
            connectionId: connection.id,
            sharePath: connection.sharePath,
            trigger,
            startTime: Date.now()
        };

        // Wrap the mount function to track completion
        const wrappedPromise = this.executeMount(key, mountFunction);
        operation.promise = wrappedPromise;

        // Register the operation
        this.activeMounts.set(key, operation as MountOperation);

        if (process.env.NODE_ENV === 'development') {
            const conflictInfo = systemMountCheck.conflictResolved ? ' (after resolving system mount conflict)' : '';
            console.log(`🚀 Starting coordinated mount for ${connection.label} (trigger: ${trigger})${conflictInfo}`);
        }

        try {
            const result = await wrappedPromise;
            return result;
        } finally {
            // Clean up the operation
            this.activeMounts.delete(key);
            if (process.env.NODE_ENV === 'development') {
                console.log(`🏁 Completed mount operation for ${connection.label} (trigger: ${trigger})`);
            }
        }
    }

    // Execute mount operation with proper error handling
    private async executeMount<T>(key: string, mountFunction: () => Promise<T>): Promise<T> {
        try {
            return await mountFunction();
        } catch (error) {
            // Re-throw the error so it can be handled by the caller
            throw error;
        }
    }

    // **ENHANCED: Check for system mount conflicts and attempt to resolve them including stale app mounts**
    private async checkAndResolveSystemMountConflicts(connection: SavedConnection): Promise<SystemMountCheck> {
        try {
            // Import SMB service functions dynamically to avoid circular dependencies
            const { detectSystemSMBMounts, isMountPointAccessible, cleanupStaleMounts } = await import('../mount/smbService');
            const { notifyMountConflictsResolved } = await import('./essentialNotifications');

            if (process.env.NODE_ENV === 'development') {
                console.log(`🔍 Checking for mount conflicts (including stale app mounts) for: ${connection.sharePath}`);
            }

            // Get all system mounts to check for both system and stale app mounts
            const systemMounts = await detectSystemSMBMounts();
            const normalizedSharePath = connection.sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
            
            // Find any mounts for this share path - handle both with/without username
            const conflictingMounts = systemMounts.filter(mount => {
                const mountPath = mount.serverPath.toLowerCase();
                
                // Direct match (without username)
                if (mountPath === normalizedSharePath) {
                    return true;
                }
                
                // Match with username stripped (system mounts often include username@server/share)
                const mountPathWithoutUser = mountPath.replace(/^[^@]+@/, '');
                if (mountPathWithoutUser === normalizedSharePath) {
                    return true;
                }
                
                // Match adding username to connection path (connection might not include username)
                if (mountPath === `${getCurrentUsername()}@${normalizedSharePath}`) {
                    return true;
                }
                
                return false;
            });

            if (conflictingMounts.length === 0) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`✅ No mount conflicts detected for: ${connection.sharePath}`);
                }
                return {
                    hasSystemMount: false,
                    conflictResolved: true
                };
            }

            if (process.env.NODE_ENV === 'development') {
                console.log(`⚠️ Found ${conflictingMounts.length} conflicting mount(s) for ${connection.sharePath}:`);
                conflictingMounts.forEach(mount => {
                    console.log(`   - ${mount.serverPath} at ${mount.mountPoint} (${mount.isAppManaged ? 'app-managed' : 'system/finder'})`);
                });
            }

            // Check accessibility of conflicting mounts and determine what needs cleanup
            let staleMountsFound = false;
            let accessibleSystemMountsFound = false;
            
            for (const mount of conflictingMounts) {
                const isAccessible = await isMountPointAccessible(mount.mountPoint);
                
                if (!isAccessible) {
                    staleMountsFound = true;
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`💀 Found stale mount: ${mount.serverPath} at ${mount.mountPoint} (${mount.isAppManaged ? 'app' : 'system'})`);
                    }
                } else if (!mount.isAppManaged) {
                    accessibleSystemMountsFound = true;
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`📁 Found accessible system mount: ${mount.serverPath} at ${mount.mountPoint}`);
                    }
                } else {
                    // Accessible app-managed mount - might be a previous mount that's still active
                    // We should clean this up too since we're about to create a new mount
                    staleMountsFound = true;
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔄 Found existing app mount: ${mount.serverPath} at ${mount.mountPoint} (will clean up for fresh mount)`);
                    }
                }
            }

            // If we have any conflicts that need resolution, clean them up
            if (staleMountsFound || accessibleSystemMountsFound) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🧹 Attempting to resolve mount conflicts for ${connection.sharePath}...`);
                }

                try {
                    const cleanupResult = await Promise.race([
                        cleanupStaleMounts(connection.sharePath),
                        new Promise<{ cleaned: number; errors: string[] }>((_, reject) => 
                            setTimeout(() => reject(new Error('Conflict resolution timeout')), COORDINATOR_CONFIG.CONFLICT_RESOLUTION_TIMEOUT)
                        )
                    ]);

                    if (cleanupResult.cleaned > 0) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Successfully resolved ${cleanupResult.cleaned} mount conflicts for ${connection.sharePath}`);
                        }
                        
                        // Notify user about successful conflict resolution
                        try {
                            await notifyMountConflictsResolved(cleanupResult.cleaned);
                        } catch (notifyError) {
                            // Don't fail mount operation if notification fails
                            if (process.env.NODE_ENV === 'development') {
                                console.warn('Failed to send conflict resolution notification:', notifyError);
                            }
                        }

                        return {
                            hasSystemMount: true,
                            mountDetails: conflictingMounts[0], // Return first conflicting mount details
                            conflictResolved: true
                        };
                    } else {
                        // Conflicts detected but couldn't be resolved
                        const errorMessage = cleanupResult.errors.length > 0 
                            ? `Failed to resolve conflicts: ${cleanupResult.errors.join(', ')}`
                            : 'Mount conflicts detected but could not be automatically resolved';
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`❌ Could not resolve mount conflicts for ${connection.sharePath}: ${errorMessage}`);
                        }

                        return {
                            hasSystemMount: true,
                            mountDetails: conflictingMounts[0],
                            conflictResolved: false,
                            error: errorMessage
                        };
                    }
                } catch (cleanupError) {
                    const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                    if (process.env.NODE_ENV === 'development') {
                        console.error(`❌ Error during conflict resolution for ${connection.sharePath}: ${errorMessage}`);
                    }

                    return {
                        hasSystemMount: true,
                        mountDetails: conflictingMounts[0],
                        conflictResolved: false,
                        error: `Conflict resolution failed: ${errorMessage}`
                    };
                }
            } else {
                // Conflicting mounts found but all are accessible and app-managed
                // This shouldn't happen but let's handle it gracefully
                if (process.env.NODE_ENV === 'development') {
                    console.log(`ℹ️ All conflicting mounts appear to be accessible app-managed mounts`);
                }
                return {
                    hasSystemMount: false,
                    conflictResolved: true
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Error checking system mount conflicts for ${connection.sharePath}: ${errorMessage}`);
            }

            // If we can't check for conflicts, allow the mount to proceed
            // The mount operation itself will handle any actual conflicts
            return {
                hasSystemMount: false,
                conflictResolved: true,
                error: `Could not check for system mount conflicts: ${errorMessage}`
            };
        }
    }

    // Queue a mount operation to be executed when no other operations are running
    async queueMount<T>(
        connection: SavedConnection,
        trigger: string,
        mountFunction: () => Promise<T>
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const queuedOperation = async () => {
                try {
                    const result = await this.coordinateMount(connection, trigger, mountFunction);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            this.mountQueue.push(queuedOperation);
            this.processQueue();
        });
    }

    // Process queued mount operations one at a time
    private async processQueue() {
        if (this.isProcessingQueue || this.mountQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.mountQueue.length > 0) {
            const operation = this.mountQueue.shift();
            if (operation) {
                try {
                    await operation();
                } catch (error) {
                    if (process.env.NODE_ENV === 'development') {
                        console.error('❌ Queued mount operation failed:', error);
                    }
                }
            }
        }

        this.isProcessingQueue = false;
    }

    // Get a unique key for the mount operation
    private getMountKey(connection: SavedConnection): string {
        // Use both connection ID and share path to ensure uniqueness
        return `${connection.id}:${connection.sharePath}`;
    }

    // Get status of all active mount operations (for debugging)
    getActiveOperations(): Array<{
        connectionId: string;
        sharePath: string;
        trigger: string;
        duration: number;
    }> {
        const now = Date.now();
        return Array.from(this.activeMounts.values()).map(op => ({
            connectionId: op.connectionId,
            sharePath: op.sharePath,
            trigger: op.trigger,
            duration: now - op.startTime
        }));
    }

    // Force cleanup of stale operations (for emergency situations)
    forceCleanup(maxAge: number = COORDINATOR_CONFIG.MAX_OPERATION_TIME): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, operation] of this.activeMounts.entries()) {
            if (now - operation.startTime > maxAge) {
                this.activeMounts.delete(key);
                cleaned++;
                if (process.env.NODE_ENV === 'development') {
                    console.log(`🧹 Cleaned up stale mount operation: ${operation.sharePath} (age: ${now - operation.startTime}ms)`);
                }
            }
        }

        return cleaned;
    }

    // Get enhanced statistics with better insights
    getStats(): CoordinatorStats {
        const now = Date.now();
        let longestRunningOperation: CoordinatorStats['longestRunningOperation'];

        if (this.activeMounts.size > 0) {
            const operations = Array.from(this.activeMounts.values());
            const longest = operations.reduce((max, op) => {
                const duration = now - op.startTime;
                return duration > (now - max.startTime) ? op : max;
            });
            
            longestRunningOperation = {
                connectionLabel: `Connection ${longest.connectionId}`,
                duration: now - longest.startTime,
                trigger: longest.trigger
            };
        }

        return {
            activeOperations: this.activeMounts.size,
            queuedOperations: this.mountQueue.length,
            longestRunningOperation
        };
    }
}

// Export singleton instance
export const mountCoordinator = MountCoordinator.getInstance();
