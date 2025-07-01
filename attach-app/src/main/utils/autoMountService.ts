// src/main/utils/autoMountService.ts
// Service for automatically mounting saved connections on app startup

import { connectionStore, SavedConnection } from './connectionStore';
import { mountSMBShare, detectMountConflict, cleanupStaleMounts, detectSystemSMBMounts, safeEjectConflictingMount } from '../mount/smbService';
import { MountedShare } from '../../types';
import { notifyMountConflictsResolved } from './essentialNotifications';
import { mountCoordinator } from './mountCoordinator';

// Enhanced interfaces with better type safety
export interface AutoMountResult {
    connection: SavedConnection;
    success: boolean;
    mountPoint?: string;
    error?: string;
    conflictsResolved?: number;
    conflictErrors?: string[];
}

// Configuration constants
const AUTO_MOUNT_CONFIG = {
    CONFLICT_RESOLUTION_DELAY: 2000, // 2 seconds delay after cleanup
    MAX_MOUNT_RETRIES: 5              // Maximum retries for mount conflicts
} as const;

export class AutoMountService {
    private readonly mountedShares: Map<string, MountedShare>;
    private readonly connectionIdToLabel: Map<string, string>; // Track connection ID to label mapping

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        this.mountedShares = mountedSharesRef;
        this.connectionIdToLabel = new Map();
    }

    /**
     * Attempt to auto-mount all saved connections that have autoMount enabled
     */
    async autoMountConnections(trigger: string = 'auto'): Promise<{
        results: AutoMountResult[];
        summary: {
            totalAttempted: number;
            successful: number;
            failed: number;
            totalConflictsResolved: number;
            connectionsWithConflicts: string[];
        };
    }> {
        const autoMountConnections = await connectionStore.getAutoMountConnections();
        const results: AutoMountResult[] = [];

        if (process.env.NODE_ENV === 'development') {
            console.log(`🚀 Starting enhanced auto-mount (trigger: ${trigger}) for ${autoMountConnections.length} connections...`);
        }

        // Process connections sequentially to avoid resource conflicts
        for (const connection of autoMountConnections) {
            const result = await this.mountConnectionWithCoordination(connection, trigger);
            results.push(result);
        }

        if (process.env.NODE_ENV === 'development') {
            const stats = mountCoordinator.getStats();
            console.log(`📊 Mount coordinator stats: ${stats.activeOperations} active, ${stats.queuedOperations} queued`);
        }

        // Calculate summary statistics
        const successful = results.filter(r => r.success).length;
        const failed = results.length - successful;
        const totalConflictsResolved = results.reduce((sum, r) => sum + (r.conflictsResolved || 0), 0);
        const connectionsWithConflicts = results
            .filter(r => (r.conflictsResolved || 0) > 0)
            .map(r => r.connection.label);

        return {
            results,
            summary: {
                totalAttempted: results.length,
                successful,
                failed,
                totalConflictsResolved,
                connectionsWithConflicts
            }
        };
    }

    /**
     * Mount a single connection with enhanced conflict resolution and coordination
     */
    private async mountConnectionWithCoordination(connection: SavedConnection, trigger: string): Promise<AutoMountResult> {
        try {
            // **ENHANCED: Check multiple mount status indicators to prevent duplicates**
            
            // 1. Check if connection is already mounted by the app (synchronous check)
            if (this.isConnectionMounted(connection)) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⚠️ Connection ${connection.label} is already mounted by the app, skipping`);
                }
                return {
                    connection,
                    success: true,
                    mountPoint: this.getMountPointForConnection(connection)
                };
            }
            
            // **NEW: 2. Enhanced system mount check to prevent duplicates after sleep/wake**
            const isAlreadyMountedSystem = await this.isConnectionMountedEnhanced(connection);
            if (isAlreadyMountedSystem) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`⚠️ Connection ${connection.label} is already mounted in system, checking accessibility...`);
                }
                
                // Try to find the existing system mount and validate it
                const systemMounts = await detectSystemSMBMounts();
                const normalizedSharePath = connection.sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
                
                const existingMount = systemMounts.find(mount => {
                    const mountPath = mount.serverPath.toLowerCase();
                    return mountPath === normalizedSharePath || 
                           mountPath.replace(/^[^@]+@/, '') === normalizedSharePath ||
                           mountPath === `${require('os').userInfo().username}@${normalizedSharePath}`;
                });
                
                if (existingMount) {
                    // Check if the existing mount is accessible
                    const { isMountPointAccessible } = await import('../mount/smbService');
                    const isAccessible = await isMountPointAccessible(existingMount.mountPoint);
                    
                    if (isAccessible) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Found accessible existing mount for ${connection.label} at ${existingMount.mountPoint}`);
                        }
                        
                        // Add to our tracking if it's not already there
                        if (!this.isConnectionMounted(connection)) {
                            const mountedShare: MountedShare = {
                                label: connection.label,
                                mountPoint: existingMount.mountPoint,
                                sharePath: connection.sharePath,
                                username: connection.username,
                                mountedAt: new Date()
                            };
                            this.mountedShares.set(connection.label, mountedShare);
                            
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`📋 Added existing system mount to app tracking: ${connection.label}`);
                            }
                        }
                        
                        return {
                            connection,
                            success: true,
                            mountPoint: existingMount.mountPoint
                        };
                    } else {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`💀 Found stale system mount for ${connection.label}, will clean up and remount`);
                        }
                        // Continue with normal mount process - the conflict resolution will handle cleanup
                    }
                }
            }

            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-mounting connection: ${connection.label} (${connection.sharePath})`);
            }

            // Use mount coordinator for enhanced conflict handling
            return await mountCoordinator.coordinateMount(
                connection,
                trigger,
                async () => {
                    // **NEW: Check for system-wide mount conflicts (Finder/system mounts)**
                    const conflictCheck = await detectMountConflict(connection.sharePath);
                    let conflictsResolved = 0;
                    let conflictErrors: string[] = [];

                    if (conflictCheck.hasConflict) {
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`🔍 Detected mount conflict for ${connection.label}, attempting to resolve...`);
                        }

                        // Try to clean up conflicting mounts
                        const cleanupResult = await cleanupStaleMounts(connection.sharePath);
                        conflictsResolved = cleanupResult.cleaned;
                        conflictErrors = cleanupResult.errors;

                        if (cleanupResult.errors.length > 0) {
                            if (process.env.NODE_ENV === 'development') {
                                console.warn(`⚠️ Some conflicts could not be resolved for ${connection.label}:`, cleanupResult.errors);
                            }
                            // Don't fail the mount - try anyway as conflicts might be resolved
                        }

                        if (conflictsResolved > 0) {
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`✅ Resolved ${conflictsResolved} mount conflicts for ${connection.label}`);
                            }

                            // Brief delay to let system settle after ejecting conflicting mounts
                            await new Promise(resolve => setTimeout(resolve, AUTO_MOUNT_CONFIG.CONFLICT_RESOLUTION_DELAY));
                        }
                    }

                    // Get password for the connection
                    const password = await connectionStore.getPassword(connection.id);
                    if (!password) {
                        throw new Error('No password found for connection');
                    }

                    let mountPoint: string;
                    try {
                        mountPoint = await mountSMBShare(
                            connection.sharePath,
                            connection.username,
                            password
                        );
                    } catch (mountError: any) {
                        // **NEW: Handle specific mount conflict error (-1073741412)**
                        if (mountError.isConflictError) {
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`🔧 Mount conflict error detected, performing aggressive cleanup and retry...`);
                            }
                            
                            // Import aggressive cleanup function
                            const { aggressiveConflictCleanup } = require('../mount/smbService');
                            
                            // Perform aggressive cleanup targeting Finder mounts
                            const aggressiveCleanup = await aggressiveConflictCleanup(connection.sharePath);
                            if (process.env.NODE_ENV === 'development') {
                                console.log(`🧹 Aggressive cleanup results: ${aggressiveCleanup.cleaned} cleaned, ${aggressiveCleanup.errors.length} errors`);
                                if (aggressiveCleanup.foundFinderMounts) {
                                    console.log(`🍎 Found and processed Finder mounts`);
                                } else {
                                    console.log(`ℹ️ No Finder mounts found - error may be due to filesystem conflicts`);
                                }
                                if (aggressiveCleanup.errors.length > 0) {
                                    console.log(`⚠️ Cleanup errors:`, aggressiveCleanup.errors);
                                }
                            }
                            
                            // Update conflict tracking
                            conflictsResolved += aggressiveCleanup.cleaned;
                            conflictErrors.push(...aggressiveCleanup.errors);
                            
                            // Wait longer for system to settle after aggressive cleanup
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
                            // Retry mount once
                            try {
                                mountPoint = await mountSMBShare(
                                    connection.sharePath,
                                    connection.username,
                                    password
                                );
                                if (process.env.NODE_ENV === 'development') {
                                    console.log(`✅ Mount successful after aggressive cleanup retry (resolved ${conflictsResolved} total conflicts)`);
                                }
                                
                                // Notify user about conflict resolution if we found and cleaned up mounts
                                if (conflictsResolved > 0) {
                                    try {
                                        await notifyMountConflictsResolved(conflictsResolved);
                                    } catch (notifyError) {
                                        if (process.env.NODE_ENV === 'development') {
                                            console.warn('Failed to send conflict resolution notification:', notifyError);
                                        }
                                    }
                                }
                            } catch (retryError) {
                                if (process.env.NODE_ENV === 'development') {
                                    console.error(`❌ Mount failed even after aggressive cleanup: ${retryError}`);
                                }
                                throw retryError;
                            }
                        } else {
                            throw mountError;
                        }
                    }

                    // Create mounted share entry
                    const mountedShare: MountedShare = {
                        label: connection.label,
                        mountPoint,
                        sharePath: connection.sharePath,
                        username: connection.username,
                        mountedAt: new Date()
                    };

                    // Add to mounted shares map and track connection ID
                    this.mountedShares.set(connection.label, mountedShare);
                    this.connectionIdToLabel.set(connection.id, connection.label);

                    if (process.env.NODE_ENV === 'development') {
                        console.log(`✅ Auto-mounted: ${connection.label} -> ${mountPoint}`);
                    }

                    // Send user notification if we resolved conflicts (don't duplicate with retry notifications)
                    if (conflictsResolved > 0) {
                        try {
                            await notifyMountConflictsResolved(conflictsResolved);
                        } catch (notifyError) {
                            if (process.env.NODE_ENV === 'development') {
                                console.warn('Failed to send conflict resolution notification:', notifyError);
                            }
                        }
                    }

                    return {
                        connection,
                        success: true,
                        mountPoint,
                        conflictsResolved: conflictsResolved || undefined,
                        conflictErrors: conflictErrors.length > 0 ? conflictErrors : undefined
                    };
                }
            );
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Auto-mount failed for ${connection.label}:`, error.message);
            }
            return {
                connection,
                success: false,
                error: error.message
            };
        }
    }

    // Check if a connection is currently mounted (synchronous - checks only app tracking)
    isConnectionMounted(connection: SavedConnection): boolean {
        return this.mountedShares.has(connection.label);
    }

    // Enhanced version that checks both app tracking and actual system mounts
    async isConnectionMountedEnhanced(connection: SavedConnection): Promise<boolean> {
        // First check app tracking
        if (this.isConnectionMounted(connection)) {
            return true;
        }

        // Then check system mounts
        try {
            const systemMounts = await detectSystemSMBMounts();
            const normalizedSharePath = connection.sharePath.replace(/^smb:\/\//, '').replace(/^\/\//, '').toLowerCase();
            const hasSystemMount = systemMounts.some((mount: { serverPath: string; mountPoint: string; isAppManaged: boolean }) =>
                mount.serverPath.toLowerCase() === normalizedSharePath
            );
            return hasSystemMount;
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.warn(`Error checking system mounts for ${connection.label}:`, error);
            }
            return false;
        }
    }

    // Clean up all stale mounts system-wide (useful for app startup and manual cleanup)
    async cleanupAllStaleMounts(): Promise<{
        totalCleaned: number;
        errors: string[];
        cleanedMounts: Array<{ serverPath: string; mountPoint: string }>;
    }> {
        const errors: string[] = [];
        const cleanedMounts: Array<{ serverPath: string; mountPoint: string }> = [];
        let totalCleaned = 0;

        try {
            if (process.env.NODE_ENV === 'development') {
                console.log('🧹 Starting system-wide stale mount cleanup...');
            }

            const systemMounts = await detectSystemSMBMounts();

            for (const mount of systemMounts) {
                // Only clean up non-app-managed mounts (Finder/system mounts)
                if (!mount.isAppManaged) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔍 Found system mount: ${mount.serverPath} at ${mount.mountPoint}`);
                    }

                    const result = await safeEjectConflictingMount(mount.mountPoint, mount.serverPath);
                    if (result.success) {
                        totalCleaned++;
                        cleanedMounts.push({
                            serverPath: mount.serverPath,
                            mountPoint: mount.mountPoint
                        });
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`✅ Cleaned up system mount: ${mount.mountPoint}`);
                        }
                    } else {
                        errors.push(result.error || `Failed to clean up ${mount.mountPoint}`);
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`❌ Failed to clean up ${mount.mountPoint}: ${result.error}`);
                        }
                    }
                }
            }

            if (process.env.NODE_ENV === 'development') {
                console.log(`🧹 System-wide cleanup completed: ${totalCleaned} cleaned, ${errors.length} errors`);
            }

            return { totalCleaned, errors, cleanedMounts };
        } catch (error) {
            const errorMessage = `Error during system-wide stale mount cleanup: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMessage);
            if (process.env.NODE_ENV === 'development') {
                console.error('❌ System-wide cleanup failed:', error);
            }
            return { totalCleaned, errors, cleanedMounts };
        }
    }

    // Re-mount a previously mounted connection (useful after network reconnection)
    async remountConnection(connectionId: string): Promise<AutoMountResult | null> {
        const connection = await connectionStore.getConnection(connectionId);
        if (!connection) {
            return null;
        }

        // Only remount if it's not currently mounted
        if (!this.isConnectionMounted(connection)) {
            const result = await this.mountConnectionWithCoordination(connection, 'remount');
            return result;
        }

        return {
            connection,
            success: true,
            mountPoint: this.getMountPointForConnection(connection)
        };
    }

    // Get mount point for a connection if it's currently mounted
    getMountPointForConnection(connection: SavedConnection): string | undefined {
        const mountedShare = this.mountedShares.get(connection.label);
        return mountedShare?.mountPoint;
    }

    // Get summary statistics for auto-mount operations
    getAutoMountSummary(): {
        totalMounted: number;
        mountedConnections: Array<{ label: string; mountPoint: string; mountedAt: Date }>;
    } {
        const mountedConnections = Array.from(this.mountedShares.values()).map(share => ({
            label: share.label,
            mountPoint: share.mountPoint,
            mountedAt: share.mountedAt
        }));

        return {
            totalMounted: this.mountedShares.size,
            mountedConnections
        };
    }

    /**
     * Update a mounted share's details when connection information changes
     * This is called when a user edits connection details in settings
     */
    async updateMountedShareDetails(connectionId: string, updatedConnection: SavedConnection): Promise<{
        success: boolean;
        wasUpdated: boolean;
        needsRemount: boolean;
        oldLabel?: string;
        message: string;
    }> {
        try {
            // Find the mounted share using connection ID mapping first
            let oldLabel = this.connectionIdToLabel.get(connectionId);
            let oldMountedShare: MountedShare | undefined;

            if (oldLabel) {
                oldMountedShare = this.mountedShares.get(oldLabel);
            }

            // Fallback: search by connection details if ID mapping failed
            if (!oldMountedShare) {
                for (const [label, share] of this.mountedShares.entries()) {
                    if (share.sharePath === updatedConnection.sharePath && share.username === updatedConnection.username) {
                        oldMountedShare = share;
                        oldLabel = label;
                        break;
                    }
                }
            }

            if (!oldMountedShare) {
                return {
                    success: true,
                    wasUpdated: false,
                    needsRemount: false,
                    message: 'Connection is not currently mounted'
                };
            }

            // Check if critical details that require remounting have changed
            const needsRemount = (
                oldMountedShare.sharePath !== updatedConnection.sharePath ||
                oldMountedShare.username !== updatedConnection.username
            );

            // Update the mounted share entry
            const updatedMountedShare: MountedShare = {
                ...oldMountedShare,
                label: updatedConnection.label,
                sharePath: updatedConnection.sharePath,
                username: updatedConnection.username
            };

            // Remove old entry and add updated entry
            if (oldLabel && oldLabel !== updatedConnection.label) {
                this.mountedShares.delete(oldLabel);
                this.connectionIdToLabel.delete(connectionId); // Clean up old mapping
            }
            
            // Add with updated label
            this.mountedShares.set(updatedConnection.label, updatedMountedShare);
            this.connectionIdToLabel.set(connectionId, updatedConnection.label);

            if (process.env.NODE_ENV === 'development') {
                console.log(`📝 Updated mounted share details: ${oldLabel} -> ${updatedConnection.label}`);
                if (needsRemount) {
                    console.log(`⚠️ Connection requires remounting due to critical changes`);
                }
            }

            return {
                success: true,
                wasUpdated: true,
                needsRemount,
                oldLabel,
                message: needsRemount 
                    ? 'Connection updated. Remount required for changes to take effect.'
                    : 'Connection details updated successfully.'
            };

        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Failed to update mounted share details:`, error);
            }
            return {
                success: false,
                wasUpdated: false,
                needsRemount: false,
                message: `Failed to update mounted share: ${error.message}`
            };
        }
    }

    /**
     * Remount a connection after details have been updated
     * This ensures the updated connection details are properly reflected
     */
    async remountUpdatedConnection(connectionId: string, oldLabel?: string): Promise<AutoMountResult> {
        try {
            const connection = await connectionStore.getConnection(connectionId);
            if (!connection) {
                throw new Error('Connection not found');
            }

            // First unmount the old connection if it exists
            const labelToUnmount = oldLabel || this.connectionIdToLabel.get(connectionId);
            if (labelToUnmount) {
                const oldMountedShare = this.mountedShares.get(labelToUnmount);
                if (oldMountedShare) {
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔄 Unmounting old connection: ${labelToUnmount}`);
                    }

                    // Import unmount function
                    const { unmountSMBShare } = await import('../mount/smbService');
                    
                    try {
                        await unmountSMBShare(oldMountedShare.mountPoint);
                        this.mountedShares.delete(labelToUnmount);
                        this.connectionIdToLabel.delete(connectionId); // Clean up ID mapping
                    } catch (unmountError) {
                        if (process.env.NODE_ENV === 'development') {
                            console.warn(`⚠️ Failed to unmount old connection, proceeding with new mount:`, unmountError);
                        }
                        // Continue with remounting even if unmount fails
                    }
                }
            }

            // Now mount with the updated connection details
            const result = await this.mountConnectionWithCoordination(connection, 'remount-after-edit');
            
            if (result.success && process.env.NODE_ENV === 'development') {
                console.log(`✅ Successfully remounted updated connection: ${connection.label}`);
            }

            return result;

        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Failed to remount updated connection:`, error);
            }
            return {
                connection: (await connectionStore.getConnection(connectionId))!,
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get mounted share by connection ID or connection details
     */
    getMountedShareByConnection(connection: SavedConnection): MountedShare | undefined {
        // First try by current label
        const byLabel = this.mountedShares.get(connection.label);
        if (byLabel) return byLabel;

        // Then search by share path and username
        for (const share of this.mountedShares.values()) {
            if (share.sharePath === connection.sharePath && share.username === connection.username) {
                return share;
            }
        }

        return undefined;
    }

    /**
     * Check if a connection is mounted and return its current status
     */
    getConnectionMountStatus(connection: SavedConnection): {
        isMounted: boolean;
        mountedShare?: MountedShare;
        currentLabel?: string;
        hasLabelMismatch: boolean;
    } {
        const mountedShare = this.getMountedShareByConnection(connection);
        const hasLabelMismatch = mountedShare ? mountedShare.label !== connection.label : false;

        return {
            isMounted: !!mountedShare,
            mountedShare,
            currentLabel: mountedShare?.label,
            hasLabelMismatch
        };
    }
}

// Function to create auto-mount service instance
export function createAutoMountService(mountedShares: Map<string, MountedShare>): AutoMountService {
    return new AutoMountService(mountedShares);
}
