// Essential network notifications - minimal system focused on critical events only
// Prevents app hanging while still providing essential user feedback

import { Notification } from 'electron';

// Configuration constants
const NOTIFICATION_CONFIG = {
    COOLDOWN_MS: 10000,  // 10 seconds between notifications
    DEFAULT_TIMEOUT: 'default' as const
} as const;

// Notification types for better type safety
type NotificationUrgency = 'low' | 'normal' | 'critical';
type NotificationTimeoutType = 'default' | 'never';

interface NotificationOptions {
    title: string;
    body: string;
    urgency?: NotificationUrgency;
    timeoutType?: NotificationTimeoutType;
}

class EssentialNotificationManager {
    private static instance: EssentialNotificationManager;
    private lastNotificationTime = 0;
    
    private constructor() {}
    
    public static getInstance(): EssentialNotificationManager {
        if (!EssentialNotificationManager.instance) {
            EssentialNotificationManager.instance = new EssentialNotificationManager();
        }
        return EssentialNotificationManager.instance;
    }
    
    /**
     * Show a notification with cooldown to prevent spam
     */
    private async showNotification(options: NotificationOptions): Promise<void> {
        const { title, body, urgency = 'normal', timeoutType = 'default' } = options;
        const now = Date.now();
        
        if (now - this.lastNotificationTime < NOTIFICATION_CONFIG.COOLDOWN_MS) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`Notification skipped (cooldown): ${title}`);
            }
            return;
        }
        
        this.lastNotificationTime = now;
        
        try {
            const notification = new Notification({
                title,
                body,
                urgency,
                timeoutType
            });
            
            notification.show();
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`📱 Notification: ${title} - ${body}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to show notification:', error);
            }
        }
    }
    
    async notifyNetworkDisconnected(): Promise<void> {
        await this.showNotification({
            title: 'Network Disconnected',
            body: 'Network connection lost. Auto-mount will retry when connection is restored.',
            urgency: 'critical'
        });
    }
    
    async notifyNetworkReconnected(): Promise<void> {
        await this.showNotification({
            title: 'Network Reconnected',
            body: 'Network connection restored. Checking network shares...',
            urgency: 'normal'
        });
    }
    
    async notifyInternetLost(): Promise<void> {
        await this.showNotification({
            title: 'Internet Connection Lost',
            body: 'Internet access unavailable. Local network shares may still work.',
            urgency: 'critical'
        });
    }
    
    async notifyInternetRestored(): Promise<void> {
        await this.showNotification({
            title: 'Internet Connection Restored',
            body: 'Internet access is back. Reconnecting network shares...',
            urgency: 'normal'
        });
    }
    
    async notifyNetworkChanged(): Promise<void> {
        await this.showNotification({
            title: 'Network Changed',
            body: 'Network configuration changed. Reconnecting shares...',
            urgency: 'normal'
        });
    }
    
    async notifySharesDisconnected(count: number): Promise<void> {
        await this.showNotification({
            title: 'Network Shares Disconnected',
            body: `${count} network share${count > 1 ? 's' : ''} disconnected due to network issues.`,
            urgency: 'critical'
        });
    }

    async notifySharesReconnected(count: number): Promise<void> {
        await this.showNotification({
            title: 'Network Shares Reconnected',
            body: `${count} network share${count > 1 ? 's' : ''} successfully reconnected.`,
            urgency: 'normal'
        });
    }

    async notifyMountConflictsResolved(count: number): Promise<void> {
        await this.showNotification({
            title: 'Mount Conflicts Resolved',
            body: `Resolved ${count} conflicting mount${count > 1 ? 's' : ''} for auto-mount.`,
            urgency: 'normal'
        });
    }

    /**
     * Specific notification for Finder mount conflicts (when WiFi reconnects)
     */
    async notifyFinderConflictsResolved(count: number): Promise<void> {
        await this.showNotification({
            title: 'Finder Mount Conflicts Resolved',
            body: `Cleared ${count} stale Finder mount${count > 1 ? 's' : ''} that were blocking reconnection.`,
            urgency: 'normal'
        });
    }
}

// Export singleton instance
export const essentialNotifications = EssentialNotificationManager.getInstance();

// Export convenience functions
export const notifyNetworkDisconnected = () => essentialNotifications.notifyNetworkDisconnected();
export const notifyNetworkReconnected = () => essentialNotifications.notifyNetworkReconnected(); 
export const notifyInternetLost = () => essentialNotifications.notifyInternetLost();
export const notifyInternetRestored = () => essentialNotifications.notifyInternetRestored();
export const notifyNetworkChanged = () => essentialNotifications.notifyNetworkChanged();
export const notifySharesDisconnected = (count: number) => essentialNotifications.notifySharesDisconnected(count);
export const notifySharesReconnected = (count: number) => essentialNotifications.notifySharesReconnected(count);
export const notifyMountConflictsResolved = (count: number) => essentialNotifications.notifyMountConflictsResolved(count);
export const notifyFinderConflictsResolved = (count: number) => essentialNotifications.notifyFinderConflictsResolved(count);
