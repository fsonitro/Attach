// Essential network notifications - minimal system focused on critical events only
// Prevents app hanging while still providing essential user feedback

import { Notification } from 'electron';

class EssentialNotificationManager {
    private static instance: EssentialNotificationManager;
    private lastNotificationTime = 0;
    private readonly NOTIFICATION_COOLDOWN = 10000; // 10 seconds between notifications
    
    private constructor() {}
    
    public static getInstance(): EssentialNotificationManager {
        if (!EssentialNotificationManager.instance) {
            EssentialNotificationManager.instance = new EssentialNotificationManager();
        }
        return EssentialNotificationManager.instance;
    }
    
    /**
     * Show a simple notification with cooldown to prevent spam
     */
    private async showNotification(title: string, body: string, urgency: 'low' | 'normal' | 'critical' = 'normal'): Promise<void> {
        // Prevent spam with cooldown
        const now = Date.now();
        if (now - this.lastNotificationTime < this.NOTIFICATION_COOLDOWN) {
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
                timeoutType: 'default'
            });
            
            notification.show();
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`📱 Essential notification: ${title}`);
            }
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                console.error('Failed to show notification:', error);
            }
        }
    }
    
    /**
     * Critical: Network/WiFi disconnected
     */
    async notifyNetworkDisconnected(): Promise<void> {
        await this.showNotification(
            'Network Disconnected',
            'WiFi connection lost. Network shares may become unavailable.',
            'critical'
        );
    }
    
    /**
     * Good news: Network/WiFi reconnected
     */
    async notifyNetworkReconnected(): Promise<void> {
        await this.showNotification(
            'Network Reconnected',
            'WiFi connection restored. Checking network shares...',
            'normal'
        );
    }
    
    /**
     * Critical: Internet connectivity lost (but WiFi still connected)
     */
    async notifyInternetLost(): Promise<void> {
        await this.showNotification(
            'Internet Connection Lost',
            'WiFi connected but no internet access. Some network shares may be affected.',
            'critical'
        );
    }
    
    /**
     * Good news: Internet connectivity restored
     */
    async notifyInternetRestored(): Promise<void> {
        await this.showNotification(
            'Internet Access Restored',
            'Full network connectivity restored.',
            'normal'
        );
    }
    
    /**
     * Warning: Network changed (different WiFi network)
     */
    async notifyNetworkChanged(): Promise<void> {
        await this.showNotification(
            'Network Changed',
            'Connected to a different network. Network shares may need to be remounted.',
            'normal'
        );
    }
    
    /**
     * Critical: All shares were disconnected due to network issues
     */
    async notifySharesDisconnected(count: number): Promise<void> {
        await this.showNotification(
            'Network Shares Disconnected',
            `${count} network share${count > 1 ? 's' : ''} disconnected due to network issues.`,
            'critical'
        );
    }

    /**
     * Info: Mount conflicts resolved during auto-mount
     */
    async notifyMountConflictsResolved(count: number): Promise<void> {
        await this.showNotification(
            'Mount Conflicts Resolved',
            `Resolved ${count} conflicting mount${count > 1 ? 's' : ''} for auto-mount.`,
            'normal'
        );
    }
}

// Export singleton and convenience functions
export const essentialNotifications = EssentialNotificationManager.getInstance();

export const notifyNetworkDisconnected = () => essentialNotifications.notifyNetworkDisconnected();
export const notifyNetworkReconnected = () => essentialNotifications.notifyNetworkReconnected(); 
export const notifyInternetLost = () => essentialNotifications.notifyInternetLost();
export const notifyInternetRestored = () => essentialNotifications.notifyInternetRestored();
export const notifyNetworkChanged = () => essentialNotifications.notifyNetworkChanged();
export const notifySharesDisconnected = (count: number) => essentialNotifications.notifySharesDisconnected(count);
export const notifyMountConflictsResolved = (count: number) => essentialNotifications.notifyMountConflictsResolved(count);
