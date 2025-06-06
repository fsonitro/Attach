// src/main/utils/connectionStore.ts
// Connection and credential management using electron-store and keytar

import keytar from 'keytar';
import Store from 'electron-store';

export interface SavedConnection {
    id: string;
    label: string;
    sharePath: string;
    username: string;
    autoMount: boolean;
    lastUsed: Date;
    createdAt: Date;
}

export interface ConnectionSettings {
    connections: SavedConnection[];
    recentConnections: string[]; // Array of connection IDs, most recent first
    autoMountEnabled: boolean;
    rememberCredentials: boolean;
    startAtLogin: boolean;
    networkWatcher: {
        enabled: boolean;
        checkInterval: number; // seconds
        retryAttempts: number;
        retryDelay: number; // seconds
    };
    mountLocation: string; // Default mount location
}

const KEYCHAIN_SERVICE = 'Attach';

class ConnectionStore {
    private store: Store<ConnectionSettings>;

    constructor() {
        this.store = new Store<ConnectionSettings>({
            defaults: {
                connections: [],
                recentConnections: [],
                autoMountEnabled: true,
                rememberCredentials: true,
                startAtLogin: false,
                networkWatcher: {
                    enabled: true,
                    checkInterval: 15,
                    retryAttempts: 5,
                    retryDelay: 2
                },
                mountLocation: `${process.env.HOME}/mounts`
            },
            name: 'connections',
            // Enable encryption for sensitive data
            encryptionKey: 'attach-app-secure-store-key',
            // Clear old data on major version changes
            clearInvalidConfig: true
        });
    }

    // Get all saved connections
    getConnections(): SavedConnection[] {
        return this.store.get('connections', []);
    }

    // Get a specific connection by ID
    async getConnection(id: string): Promise<SavedConnection | undefined> {
        const connections = this.getConnections();
        return connections.find(conn => conn.id === id);
    }

    // Get connections sorted by last used (most recent first)
    getRecentConnections(limit: number = 10): SavedConnection[] {
        const connections = this.getConnections();
        return connections
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
            .slice(0, limit);
    }

    // Get connections that should auto-mount
    getAutoMountConnections(): SavedConnection[] {
        if (!this.store.get('autoMountEnabled', true)) {
            return [];
        }
        const connections = this.getConnections();
        return connections.filter(conn => conn.autoMount);
    }

    // Save a new connection or update existing one
    async saveConnection(
        sharePath: string, 
        username: string, 
        password: string, 
        label?: string, 
        autoMount: boolean = false
    ): Promise<SavedConnection> {
        // Validate required fields
        if (!sharePath || !username) {
            throw new Error('Share path and username are required');
        }
        
        if (!password || password.trim().length === 0) {
            throw new Error('Password is required and cannot be empty');
        }
        
        const connections = this.getConnections();
        
        // Check if connection already exists
        let existingConnection = connections.find(
            conn => conn.sharePath === sharePath && conn.username === username
        );

        const now = new Date();
        
        if (existingConnection) {
            // Update existing connection
            existingConnection.label = label || existingConnection.label;
            existingConnection.autoMount = autoMount;
            existingConnection.lastUsed = now;
            
            // Update password in keychain
            await this.storePassword(existingConnection.id, password);
            
            this.store.set('connections', connections);
            this.updateRecentConnections(existingConnection.id);
            
            return existingConnection;
        } else {
            // Create new connection
            const newConnection: SavedConnection = {
                id: this.generateConnectionId(),
                label: label || `${sharePath} (${username})`,
                sharePath,
                username,
                autoMount,
                lastUsed: now,
                createdAt: now
            };

            // Store password in keychain
            await this.storePassword(newConnection.id, password);

            // Add to connections list
            connections.push(newConnection);
            this.store.set('connections', connections);
            this.updateRecentConnections(newConnection.id);

            return newConnection;
        }
    }

    // Update connection's last used time
    async updateConnectionUsage(connectionId: string): Promise<void> {
        const connections = this.getConnections();
        const connection = connections.find(conn => conn.id === connectionId);
        
        if (connection) {
            connection.lastUsed = new Date();
            this.store.set('connections', connections);
            this.updateRecentConnections(connectionId);
        }
    }

    // Remove a saved connection
    async removeConnection(connectionId: string): Promise<boolean> {
        const connections = this.getConnections();
        const index = connections.findIndex(conn => conn.id === connectionId);
        
        if (index === -1) {
            return false;
        }

        // Remove password from keychain
        await this.removePassword(connectionId);

        // Remove from connections list
        connections.splice(index, 1);
        this.store.set('connections', connections);

        // Remove from recent connections
        const recentConnections = this.store.get('recentConnections', []);
        const recentIndex = recentConnections.indexOf(connectionId);
        if (recentIndex !== -1) {
            recentConnections.splice(recentIndex, 1);
            this.store.set('recentConnections', recentConnections);
        }

        return true;
    }

    // Get stored password for a connection
    async getPassword(connectionId: string): Promise<string | null> {
        try {
            return await keytar.getPassword(KEYCHAIN_SERVICE, connectionId);
        } catch (error) {
            console.error(`Failed to retrieve password for connection ${connectionId}:`, error);
            return null;
        }
    }

    // Store password for a connection
    private async storePassword(connectionId: string, password: string): Promise<void> {
        if (!password || password.trim().length === 0) {
            throw new Error('Password cannot be empty');
        }
        
        try {
            await keytar.setPassword(KEYCHAIN_SERVICE, connectionId, password);
        } catch (error) {
            console.error(`Failed to store password for connection ${connectionId}:`, error);
            throw error;
        }
    }

    // Remove password for a connection
    private async removePassword(connectionId: string): Promise<void> {
        try {
            await keytar.deletePassword(KEYCHAIN_SERVICE, connectionId);
        } catch (error) {
            console.warn(`Failed to remove password for connection ${connectionId}:`, error);
            // Don't throw error for removal failures
        }
    }

    // Update recent connections list
    private updateRecentConnections(connectionId: string): void {
        let recentConnections = this.store.get('recentConnections', []);
        
        // Remove if already exists
        const existingIndex = recentConnections.indexOf(connectionId);
        if (existingIndex !== -1) {
            recentConnections.splice(existingIndex, 1);
        }

        // Add to front of list
        recentConnections.unshift(connectionId);

        // Keep only last 20 items
        recentConnections = recentConnections.slice(0, 20);

        this.store.set('recentConnections', recentConnections);
    }

    // Generate a unique connection ID
    private generateConnectionId(): string {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Settings getters and setters
    getAutoMountEnabled(): boolean {
        return this.store.get('autoMountEnabled', true);
    }

    setAutoMountEnabled(enabled: boolean): void {
        this.store.set('autoMountEnabled', enabled);
    }

    getRememberCredentials(): boolean {
        return this.store.get('rememberCredentials', true);
    }

    setRememberCredentials(enabled: boolean): void {
        this.store.set('rememberCredentials', enabled);
    }

    // Start at login settings
    getStartAtLogin(): boolean {
        return this.store.get('startAtLogin', false);
    }

    setStartAtLogin(enabled: boolean): void {
        this.store.set('startAtLogin', enabled);
    }

    // Network watcher settings
    getNetworkWatcherSettings() {
        return this.store.get('networkWatcher', {
            enabled: true,
            checkInterval: 15,
            retryAttempts: 5,
            retryDelay: 2
        });
    }

    setNetworkWatcherSettings(settings: Partial<ConnectionSettings['networkWatcher']>): void {
        const current = this.getNetworkWatcherSettings();
        this.store.set('networkWatcher', { ...current, ...settings });
    }

    // Mount location settings
    getMountLocation(): string {
        return this.store.get('mountLocation', `${process.env.HOME}/mounts`);
    }

    setMountLocation(location: string): void {
        this.store.set('mountLocation', location);
    }

    // Get all settings for settings window
    getAllSettings() {
        return {
            autoMountEnabled: this.getAutoMountEnabled(),
            rememberCredentials: this.getRememberCredentials(),
            startAtLogin: this.getStartAtLogin(),
            networkWatcher: this.getNetworkWatcherSettings(),
            mountLocation: this.getMountLocation()
        };
    }

    // Get connection by share path and username (for backwards compatibility)
    findConnectionByShareAndUser(sharePath: string, username?: string): SavedConnection | undefined {
        const connections = this.getConnections();
        
        if (username) {
            return connections.find((conn: SavedConnection) => 
                conn.sharePath === sharePath && conn.username === username
            );
        } else {
            // Return the most recently used connection for this share path
            return connections
                .filter((conn: SavedConnection) => conn.sharePath === sharePath)
                .sort((a: SavedConnection, b: SavedConnection) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())[0];
        }
    }

    // Clear all stored data (for debugging or reset)
    async clearAll(): Promise<void> {
        const connections = this.getConnections();
        
        // Remove all passwords from keychain
        for (const connection of connections) {
            await this.removePassword(connection.id);
        }

        // Clear the store
        this.store.clear();
    }

    // Export connections (without passwords) for backup
    exportConnections(): Omit<SavedConnection, 'id'>[] {
        const connections = this.getConnections();
        return connections.map((conn: SavedConnection) => ({
            label: conn.label,
            sharePath: conn.sharePath,
            username: conn.username,
            autoMount: conn.autoMount,
            lastUsed: conn.lastUsed,
            createdAt: conn.createdAt
        }));
    }
}

// Singleton instance
export const connectionStore = new ConnectionStore();
