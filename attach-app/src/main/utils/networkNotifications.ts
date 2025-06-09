// Network notification utility for providing user feedback about connectivity issues
// This module provides user-friendly notifications for network-related events

import { Notification, shell } from 'electron';
import * as path from 'path';

export interface NetworkNotificationOptions {
    title: string;
    body: string;
    type: 'info' | 'warning' | 'error' | 'success';
    timeout?: number;
    actions?: Array<{ text: string; action: () => void }>;
}

class NetworkNotificationManager {
    private static instance: NetworkNotificationManager;
    private notificationQueue: Array<NetworkNotificationOptions> = [];
    private isProcessing = false;
    private lastNotificationTime = 0;
    private readonly NOTIFICATION_COOLDOWN = 5000; // 5 seconds between similar notifications

    private constructor() {}

    public static getInstance(): NetworkNotificationManager {
        if (!NetworkNotificationManager.instance) {
            NetworkNotificationManager.instance = new NetworkNotificationManager();
        }
        return NetworkNotificationManager.instance;
    }

    /**
     * Show a network-related notification to the user
     */
    public async showNetworkNotification(options: NetworkNotificationOptions): Promise<void> {
        // Prevent spam by checking cooldown
        const now = Date.now();
        if (now - this.lastNotificationTime < this.NOTIFICATION_COOLDOWN) {
            if (process.env.NODE_ENV === 'development') {
                console.log('Notification skipped due to cooldown:', options.title);
            }
            return;
        }

        this.lastNotificationTime = now;

        try {
            const notification = new Notification({
                title: options.title,
                body: options.body,
                icon: this.getIconForType(options.type),
                urgency: this.getUrgencyForType(options.type),
                timeoutType: 'default'
            });

            notification.on('click', () => {
                // Default action: focus the app
                if (options.actions && options.actions.length > 0) {
                    options.actions[0].action();
                } else {
                    // Default action: bring app to focus (could be implemented)
                    if (process.env.NODE_ENV === 'development') {
                        console.log('Notification clicked:', options.title);
                    }
                }
            });

            notification.show();

            // Auto-dismiss after timeout
            if (options.timeout) {
                setTimeout(() => {
                    notification.close();
                }, options.timeout);
            }

            if (process.env.NODE_ENV === 'development') {
                console.log(`Network notification shown: ${options.title}`);
            }

        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to show notification:', error);
            }
        }
    }

    /**
     * Show a notification when network connectivity is lost
     */
    public async notifyNetworkLoss(): Promise<void> {
        await this.showNetworkNotification({
            title: 'Network Connection Lost',
            body: 'Network shares may become unavailable. The app will automatically retry when connection is restored.',
            type: 'warning',
            timeout: 8000
        });
    }

    /**
     * Show a notification when network connectivity is restored
     */
    public async notifyNetworkRestored(): Promise<void> {
        await this.showNetworkNotification({
            title: 'Network Connection Restored',
            body: 'Attempting to reconnect to network shares...',
            type: 'success',
            timeout: 5000
        });
    }

    /**
     * Show a notification when a network share becomes inaccessible
     */
    public async notifyShareInaccessible(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Network Share Unavailable',
            body: `"${shareName}" is currently inaccessible. Check your network connection or server status.`,
            type: 'error',
            timeout: 10000
        });
    }

    /**
     * Show a notification when mount operation fails due to network issues
     */
    public async notifyMountFailure(serverName: string, reason: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Mount Operation Failed',
            body: `Unable to connect to "${serverName}": ${reason}`,
            type: 'error',
            timeout: 8000
        });
    }

    /**
     * Show a notification when network operation times out
     */
    public async notifyNetworkTimeout(operation: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Network Operation Timeout',
            body: `${operation} is taking longer than expected. Check your network connection.`,
            type: 'warning',
            timeout: 6000
        });
    }

    /**
     * Show a notification when auto-mount succeeds after network recovery
     */
    public async notifyAutoMountSuccess(shareCount: number): Promise<void> {
        await this.showNetworkNotification({
            title: 'Network Shares Reconnected',
            body: `Successfully reconnected to ${shareCount} network share${shareCount !== 1 ? 's' : ''}.`,
            type: 'success',
            timeout: 5000
        });
    }

    /**
     * Show a notification when server is unreachable before mount attempt
     */
    public async notifyServerUnreachable(serverName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Server Unreachable',
            body: `Cannot reach "${serverName}". Please check the server address and your network connection.`,
            type: 'error',
            timeout: 8000
        });
    }

    /**
     * Show a notification when a network operation is starting
     */
    public async notifyNetworkOperationInProgress(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Opening Network Share',
            body: `Accessing "${shareName}"...`,
            type: 'info',
            timeout: 3000
        });
    }

    /**
     * Show a notification when a network operation completes successfully
     */
    public async notifyNetworkOperationComplete(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Share Opened',
            body: `Successfully opened "${shareName}".`,
            type: 'success',
            timeout: 2000
        });
    }

    /**
     * Show a notification when a network operation fails
     */
    public async notifyNetworkOperationFailed(shareName: string, reason: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Cannot Open Share',
            body: `Failed to open "${shareName}": ${reason}`,
            type: 'error',
            timeout: 8000
        });
    }

    /**
     * Show a notification when attempting reconnection
     */
    public async notifyReconnectionAttempt(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Reconnecting Share',
            body: `Attempting to reconnect "${shareName}"...`,
            type: 'info',
            timeout: 4000
        });
    }

    /**
     * Show a notification when reconnection succeeds
     */
    public async notifyReconnectionSuccess(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Reconnection Successful',
            body: `Successfully reconnected "${shareName}". You can now access it.`,
            type: 'success',
            timeout: 5000
        });
    }

    /**
     * Show a notification when reconnection fails
     */
    public async notifyReconnectionFailed(shareName: string): Promise<void> {
        await this.showNetworkNotification({
            title: 'Reconnection Failed',
            body: `Unable to reconnect "${shareName}". Please check the network connection and try mounting manually.`,
            type: 'error',
            timeout: 8000
        });
    }

    private getIconForType(type: string): string | undefined {
        // You could add custom icons here
        // For now, let the system choose appropriate icons
        return undefined;
    }

    private getUrgencyForType(type: string): 'low' | 'normal' | 'critical' {
        switch (type) {
            case 'error':
                return 'critical';
            case 'warning':
                return 'normal';
            case 'info':
            case 'success':
            default:
                return 'low';
        }
    }

    /**
     * Clear the notification queue and reset cooldown
     */
    public reset(): void {
        this.notificationQueue = [];
        this.isProcessing = false;
        this.lastNotificationTime = 0;
    }
}

// Export singleton instance
export const networkNotifications = NetworkNotificationManager.getInstance();

// Convenience functions for common notification types
export const notifyNetworkLoss = () => networkNotifications.notifyNetworkLoss();
export const notifyNetworkRestored = () => networkNotifications.notifyNetworkRestored();
export const notifyShareInaccessible = (shareName: string) => networkNotifications.notifyShareInaccessible(shareName);
export const notifyMountFailure = (serverName: string, reason: string) => networkNotifications.notifyMountFailure(serverName, reason);
export const notifyNetworkTimeout = (operation: string) => networkNotifications.notifyNetworkTimeout(operation);
export const notifyAutoMountSuccess = (shareCount: number) => networkNotifications.notifyAutoMountSuccess(shareCount);
export const notifyServerUnreachable = (serverName: string) => networkNotifications.notifyServerUnreachable(serverName);
export const notifyNetworkOperationInProgress = (shareName: string) => networkNotifications.notifyNetworkOperationInProgress(shareName);
export const notifyNetworkOperationComplete = (shareName: string) => networkNotifications.notifyNetworkOperationComplete(shareName);
export const notifyNetworkOperationFailed = (shareName: string, reason: string) => networkNotifications.notifyNetworkOperationFailed(shareName, reason);
export const notifyReconnectionAttempt = (shareName: string) => networkNotifications.notifyReconnectionAttempt(shareName);
export const notifyReconnectionSuccess = (shareName: string) => networkNotifications.notifyReconnectionSuccess(shareName);
export const notifyReconnectionFailed = (shareName: string) => networkNotifications.notifyReconnectionFailed(shareName);
