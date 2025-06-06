// src/main/utils/autoMountService.ts
// Service for automatically mounting saved connections on app startup

import { connectionStore, SavedConnection } from './connectionStore';
import { mountSMBShare } from '../mount/smbService';
import { MountedShare } from '../../types';

export interface AutoMountResult {
    connection: SavedConnection;
    success: boolean;
    mountPoint?: string;
    error?: string;
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

    // Mount a specific saved connection
    async mountConnection(connection: SavedConnection): Promise<AutoMountResult> {
        try {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-mounting connection: ${connection.label} (${connection.sharePath})`);
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
            connectionStore.updateConnectionUsage(connection.id);

            if (process.env.NODE_ENV === 'development') {
                console.log(`✅ Auto-mounted: ${connection.label} -> ${mountPoint}`);
            }

            return {
                connection,
                success: true,
                mountPoint
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

    // Get summary of auto-mount results
    getAutoMountSummary(results: AutoMountResult[]): {
        total: number;
        successful: number;
        failed: number;
        successfulConnections: string[];
        failedConnections: Array<{name: string, error: string}>;
    } {
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        return {
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            successfulConnections: successful.map(r => r.connection.label),
            failedConnections: failed.map(r => ({
                name: r.connection.label,
                error: r.error || 'Unknown error'
            }))
        };
    }

    // Check if a connection is currently mounted
    isConnectionMounted(connection: SavedConnection): boolean {
        return Array.from(this.mountedShares.values()).some(
            share => share.sharePath === connection.sharePath && 
                     share.username === connection.username
        );
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
