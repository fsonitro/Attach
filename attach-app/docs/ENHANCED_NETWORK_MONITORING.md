# Enhanced Network Share Monitoring and VPN Disconnection Handling

## Overview

This system provides comprehensive network share monitoring with special focus on VPN disconnection scenarios. It addresses the common issue where macOS Finder becomes unresponsive when network shares become inaccessible, particularly during VPN disconnections.

## Key Features

### 🔒 VPN Detection and Handling
- **Automatic VPN Detection**: Monitors VPN interfaces (utun, ppp, tun, tap) and routes
- **VPN Disconnection Response**: Immediately detects VPN disconnections and takes preventive action
- **VPN-Dependent Share Detection**: Identifies shares that likely require VPN connectivity
- **Automatic Reconnection**: Attempts to reconnect VPN-dependent shares when VPN is restored

### 📊 Share Health Monitoring
- **Real-time Monitoring**: Checks share accessibility every 30 seconds
- **Fast Connectivity Checks**: Quick server reachability tests using netcat and DNS
- **Health Status Tracking**: Monitors mount status and accessibility separately
- **Event-driven Architecture**: Emits events for all state changes

### ⚡ Force Disconnection Prevention
- **Finder Freeze Prevention**: Automatically disconnects inaccessible shares to prevent macOS Finder hanging
- **Timeout Protection**: Uses aggressive timeouts to prevent operations from blocking
- **Safe Unmounting**: Force unmounts shares that are mounted but not accessible
- **Directory Cleanup**: Removes orphaned mount directories

### 🔄 Intelligent Reconnection
- **Exponential Backoff**: Smart retry logic with increasing delays (5s to 2min max)
- **Maximum Retry Limits**: Prevents infinite retry loops (max 5 attempts)
- **Server Connectivity Checks**: Verifies server reachability before mount attempts
- **User Notifications**: Keeps users informed throughout the reconnection process

### 📢 Comprehensive Notifications
- **VPN Status Changes**: Notifications for VPN connect/disconnect events
- **Share Status Updates**: Real-time alerts about share accessibility
- **Reconnection Progress**: Updates during automatic reconnection attempts
- **Error Reporting**: Clear error messages for troubleshooting
- **Success Confirmations**: Notifications when shares are successfully reconnected

## System Architecture

### Core Components

#### 1. ShareMonitoringService (`shareMonitoringService.ts`)
The heart of the monitoring system that tracks individual share health and manages reconnections.

**Key Features:**
- Periodic health checks (30-second intervals)
- VPN dependency detection
- Force disconnection capabilities
- Exponential backoff reconnection
- Event emission for state changes

**Configuration:**
```typescript
private readonly MONITORING_INTERVAL = 30000; // Check every 30 seconds
private readonly MAX_RECONNECT_ATTEMPTS = 5; // Maximum retry attempts
private readonly RECONNECT_DELAY_BASE = 5000; // Base delay: 5 seconds
private readonly RECONNECT_DELAY_MAX = 120000; // Max delay: 2 minutes
private readonly FORCE_DISCONNECT_TIMEOUT = 5000; // Timeout for forced disconnection
```

#### 2. Enhanced NetworkWatcher (`networkWatcher.ts`)
Extended network monitoring service with VPN detection and share monitoring integration.

**New Features:**
- VPN status monitoring
- Integration with ShareMonitoringService
- VPN-dependent share handling
- Enhanced event emission

#### 3. Enhanced Notifications (`networkNotifications.ts`)
Expanded notification system for VPN and share monitoring events.

**New Notification Types:**
- VPN disconnection/reconnection alerts
- Forced disconnection warnings
- Share monitoring alerts
- Auto-reconnection progress updates

#### 4. Enhanced SMB Service (`smbService.ts`)
Improved SMB operations with monitoring integration.

**New Functions:**
- `quickConnectivityCheck()`: Fast server reachability testing
- `mountSMBShareWithMonitoring()`: Mount operation with progress notifications
- Enhanced `validateMountedShares()`: Better validation with monitoring alerts

## Usage Examples

### Programmatic Usage

#### Get Comprehensive Monitoring Status
```typescript
const status = await window.api.getMonitoringStatus();
console.log('Network:', status.network);
console.log('VPN:', status.vpn);
console.log('Shares:', status.shares);
```

#### Force Health Check on All Shares
```typescript
const result = await window.api.forceShareHealthCheck();
console.log(result.message); // "Health check completed for 3 shares"
```

#### Force Reconnection of Specific Share
```typescript
const result = await window.api.forceShareReconnection('MyShare');
console.log(result.message); // "Reconnection attempt initiated for MyShare"
```

#### Quick Server Connectivity Check
```typescript
const result = await window.api.quickConnectivityCheck('192.168.1.100');
console.log('Server accessible:', result.accessible);
console.log('Method:', result.method); // "SMB port check" or "DNS resolution"
```

#### Get Detailed Monitoring Statistics
```typescript
const stats = await window.api.getShareMonitoringStats();
stats.shares.forEach(share => {
    console.log(`${share.label}: accessible=${share.isAccessible}, attempts=${share.reconnectAttempts}`);
});
```

### Event Handling

The system emits various events that can be listened to:

```typescript
// In the main process
networkWatcher.on('vpn-disconnected', () => {
    console.log('VPN connection lost - initiating share disconnection');
});

networkWatcher.on('share-disconnected', ({ label, status }) => {
    console.log(`Share ${label} disconnected - starting monitoring`);
});

networkWatcher.on('share-reconnected', ({ label, status }) => {
    console.log(`Share ${label} successfully reconnected`);
});
```

## Configuration

### VPN Detection Keywords
The system identifies VPN-dependent shares by checking for these keywords in the share path:
```typescript
private readonly VPN_DETECTION_KEYWORDS = ['vpn', 'tunnel', 'private', 'remote'];
```

### Monitoring Intervals
```typescript
// Share health monitoring
MONITORING_INTERVAL = 30000; // 30 seconds

// Quick check after disconnection
QUICK_CHECK_INTERVAL = 10000; // 10 seconds

// Network status checking
NETWORK_CHECK_INTERVAL = 15000; // 15 seconds
```

### Reconnection Strategy
```typescript
// Exponential backoff configuration
RECONNECT_DELAY_BASE = 5000; // 5 seconds initial delay
RECONNECT_DELAY_MAX = 120000; // 2 minutes maximum delay
MAX_RECONNECT_ATTEMPTS = 5; // Maximum retry attempts
```

## Notification Examples

### VPN Disconnection
**Title:** "VPN Connection Lost"  
**Message:** "VPN-dependent network shares will be disconnected to prevent system issues. Reconnection will be attempted when VPN is restored."

### Share Disconnection
**Title:** "Network Share Unavailable"  
**Message:** '"MyShare" is currently inaccessible. Check your network connection or server status.'

### Forced Disconnection
**Title:** "Disconnecting Inaccessible Shares"  
**Message:** "Forcibly disconnecting 2 shares to prevent system freezing. Reconnection will be attempted automatically."

### Successful Reconnection
**Title:** "Reconnection Successful"  
**Message:** 'Successfully reconnected "MyShare". You can now access it.'

## Troubleshooting

### Common Scenarios

#### VPN Disconnection
1. **Detection**: System detects VPN interface loss
2. **Action**: VPN-dependent shares are identified and force-disconnected
3. **Notification**: User is informed about the disconnection
4. **Recovery**: When VPN reconnects, auto-mount attempts begin

#### Network Share Becomes Inaccessible
1. **Detection**: Health check fails during periodic monitoring
2. **Action**: Share is marked as inaccessible and force-disconnected if still mounted
3. **Notification**: User is alerted about the issue
4. **Recovery**: Automatic reconnection attempts with exponential backoff

#### Finder Freezing Prevention
1. **Problem**: Share mounted but not accessible (common with network issues)
2. **Detection**: `isMountPoint() = true` but `isMountPointAccessible() = false`
3. **Action**: Force unmount with timeout protection
4. **Result**: Finder remains responsive, automatic reconnection scheduled

### Monitoring Health Check

To verify the system is working correctly:

```typescript
// Check if monitoring is active
const stats = await window.api.getShareMonitoringStats();
console.log('Monitoring active:', stats.isActive);

// Check individual share status
stats.shares.forEach(share => {
    console.log(`${share.label}:`, {
        accessible: share.isAccessible,
        connected: share.isConnected,
        vpnDependent: share.requiresVPN,
        reconnectAttempts: share.reconnectAttempts,
        lastChecked: share.lastChecked
    });
});
```

## Benefits

### For Users
- **No More Finder Freezing**: Automatic disconnection prevents macOS Finder from becoming unresponsive
- **Seamless VPN Experience**: Shares are automatically managed during VPN connect/disconnect cycles
- **Clear Communication**: Always know what's happening with your network shares
- **Automatic Recovery**: No manual intervention needed when connectivity is restored

### For Developers
- **Event-Driven Architecture**: Easy to extend and integrate with other components
- **Comprehensive APIs**: Full programmatic control over monitoring and reconnection
- **Detailed Logging**: Extensive debug information for troubleshooting
- **Modular Design**: Each component can be used independently

## Future Enhancements

### Planned Features
- **Smart VPN Detection**: More sophisticated VPN dependency analysis
- **Custom Retry Policies**: Per-share reconnection strategies
- **Bandwidth-Aware Monitoring**: Adjust check frequency based on connection quality
- **Share Grouping**: Logical grouping of related shares for batch operations
- **Advanced Notifications**: Customizable notification preferences and actions

### Integration Opportunities
- **UI Dashboard**: Real-time monitoring status display
- **Share Management Interface**: GUI for configuring monitoring settings
- **Statistics and Analytics**: Historical connection reliability data
- **Backup Share Priorities**: Intelligent failover to alternate servers

This system transforms network share management from a manual, error-prone process into an automated, intelligent experience that keeps users productive even when network conditions change.
