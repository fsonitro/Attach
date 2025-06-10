// src/main/utils/autoMountService.ts
// Service for automatically mounting saved connections on app startup

import { connectionStore, SavedConnection } from './connectionStore';
import { mountSMBShare, detectMountConflict, cleanupStaleMounts } from '../mount/smbService';
import { MountedShare } from '../../types';
import { notifyMountConflictsResolved } from './essentialNotifications';

export interface AutoMountResult {
    connection: SavedConnection;
    success: boolean;
    mountPoint?: string;
    error?: string;
    conflictsResolved?: number;
    conflictErrors?: string[];
}

export class AutoMountService {
    private mountedShares: Map<string, MountedShare>;

    constructor(mountedSharesRef: Map<string, MountedShare>) {
        this.mountedShares = mountedSharesRef;
    }

    // Attempt to auto-mount all saved connections that have autoMount enabled
    async autoMountConnections(): Promise<AutoMountResult[]> {
        const autoMountConnections = await connectionStore.getAutoMountConnections();
        const results: AutoMountResult[] = [];

        if (process.env.NODE_ENV === 'development') {
            console.log(`Starting auto-mount for ${autoMountConnections.length} connections...`);
        }

        for (const connection of autoMountConnections) {
            const result = await this.mountConnection(connection);
            results.push(result);
        }

        return results;
    }

    // Mount a specific saved connection with conflict detection and resolution
    async mountConnection(connection: SavedConnection): Promise<AutoMountResult> {
        try {
            // Check if connection is already mounted by the app
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

            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-mounting connection: ${connection.label} (${connection.sharePath})`);
            }

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
                    
                    // Notify user about conflict resolution
                    try {
                        await notifyMountConflictsResolved(conflictsResolved);
                    } catch (notifyError) {
                        // Don't fail mount if notification fails
                        if (process.env.NODE_ENV === 'development') {
                            console.warn('Failed to send conflict resolution notification:', notifyError);
                        }
                    }
                }
            }

            // Get password from keychain
            const password = await connectionStore.getPassword(connection.id);
            if (!password) {
                throw new Error('Password not found in keychain');
            }

            // Attempt to mount (with a small delay if conflicts were resolved)
            if (conflictsResolved > 0) {
                // Brief delay to let system settle after ejecting conflicting mounts
                await new Promise(resolve => setTimeout(resolve, 2000));
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

            // Update connection usage
            connectionStore.updateConnectionUsage(connection.id);

            if (process.env.NODE_ENV === 'development') {
                console.log(`✅ Auto-mounted: ${connection.label} -> ${mountPoint}`);
                if (conflictsResolved > 0) {
                    console.log(`   (Resolved ${conflictsResolved} conflicts during mount)`);
                }
            }

            return {
                connection,
                success: true,
                mountPoint,
                conflictsResolved,
                conflictErrors: conflictErrors.length > 0 ? conflictErrors : undefined
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (process.env.NODE_ENV === 'development') {
                console.error(`❌ Failed to auto-mount ${connection.label}: ${errorMessage}`);
            }

            return {
                connection,
                success: false,
                error: errorMessage
            };
        }
    }

    // Get summary of auto-mount results with conflict resolution info
    getAutoMountSummary(results: AutoMountResult[]): {
        total: number;
        successful: number;
        failed: number;
        successfulConnections: string[];
        failedConnections: Array<{name: string, error: string}>;
        totalConflictsResolved: number;
        connectionsWithConflicts: string[];
    } {
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const totalConflictsResolved = results.reduce((sum, r) => sum + (r.conflictsResolved || 0), 0);
        const connectionsWithConflicts = results
            .filter(r => r.conflictsResolved && r.conflictsResolved > 0)
            .map(r => r.connection.label);

        return {
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            successfulConnections: successful.map(r => r.connection.label),
            failedConnections: failed.map(r => ({
                name: r.connection.label,
                error: r.error || 'Unknown error'
            })),
            totalConflictsResolved,
            connectionsWithConflicts
        };
    }

    // Check if a connection is currently mounted
    isConnectionMounted(connection: SavedConnection): boolean {
        return Array.from(this.mountedShares.values()).some(
            share => share.sharePath === connection.sharePath && 
                     share.username === connection.username
        );
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

            // Import the detection function
            const { detectSystemSMBMounts, safeEjectConflictingMount } = require('../mount/smbService');
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
            if (process.env.NODE_ENV === 'development') {
                console.error(`Connection not found: ${connectionId}`);
            }
            return null;
        }

        // Check if already mounted
        if (this.isConnectionMounted(connection)) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Connection ${connection.label} is already mounted`);
            }
            return {
                connection,
                success: true,
                mountPoint: this.getMountPointForConnection(connection)
            };
        }

        return await this.mountConnection(connection);
    }

    // Get mount point for a connection if it's currently mounted
    private getMountPointForConnection(connection: SavedConnection): string | undefined {
        const mountedShare = Array.from(this.mountedShares.values()).find(
            share => share.sharePath === connection.sharePath && 
                     share.username === connection.username
        );
        return mountedShare?.mountPoint;
    }
}

// Function to create auto-mount service instance
export function createAutoMountService(mountedShares: Map<string, MountedShare>): AutoMountService {
    return new AutoMountService(mountedShares);
}
