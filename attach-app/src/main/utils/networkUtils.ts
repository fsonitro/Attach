// src/main/utils/networkUtils.ts
// Shared network utilities for consistent connectivity checking across the application

import { promisify } from 'util';
import { exec } from 'child_process';
import * as dns from 'dns';
import * as https from 'https';

const execPromise = promisify(exec);
const dnsLookup = promisify(dns.lookup);

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Custom network connectivity check using DNS and HTTPS
 * More reliable than ping and works across all platforms
 */
export async function customNetworkCheck(timeout: number = 5000, forceLogging: boolean = false): Promise<boolean> {
    const enableLogging = isDevelopment || forceLogging;
    
    return new Promise((resolve) => {
        let resolved = false;
        
        // Set timeout
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (enableLogging) console.log('🔍 [NetworkCheck] Custom check timed out after', timeout, 'ms');
                resolve(false);
            }
        }, timeout);
        
        // Try DNS lookup first (fast and reliable)
        if (enableLogging) console.log('🔍 [NetworkCheck] Attempting DNS lookup for google.com...');
        dnsLookup('google.com').then(() => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                if (enableLogging) console.log('✅ [NetworkCheck] Network check successful via DNS lookup');
                resolve(true);
            }
        }).catch((dnsError) => {
            if (enableLogging) console.log('⚠️ [NetworkCheck] DNS lookup failed, trying HTTPS fallback...', dnsError.message);
            
            // If DNS fails, try HTTPS request
            const req = https.request({
                hostname: 'google.com',
                port: 443,
                path: '/',
                method: 'HEAD',
                timeout: Math.max(1000, timeout - 1000) // Leave some time for DNS
            }, (res) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    if (enableLogging) console.log('✅ [NetworkCheck] Network check successful via HTTPS request, status:', res.statusCode);
                    resolve(res.statusCode !== undefined);
                }
            });
            
            req.on('error', (httpsError) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    if (enableLogging) console.log('❌ [NetworkCheck] Both DNS and HTTPS checks failed:', httpsError.message);
                    resolve(false);
                }
            });
            
            req.on('timeout', () => {
                req.destroy();
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    if (enableLogging) console.log('⏰ [NetworkCheck] HTTPS request timed out');
                    resolve(false);
                }
            });
            
            req.end();
        });
    });
}

/**
 * Network connectivity check with ping fallback
 * Uses custom DNS/HTTPS method first, falls back to ping if needed
 */
export async function reliableNetworkCheck(timeout: number = 3000): Promise<boolean> {
    try {
        // Try custom method first
        return await customNetworkCheck(timeout);
    } catch (error) {
        // Fallback to ping if custom check fails
        try {
            await execPromise('ping -c 1 -W 2000 8.8.8.8', { timeout });
            return true;
        } catch (pingError) {
            return false;
        }
    }
}

/**
 * Quick network check for time-sensitive operations
 * Uses shorter timeout for faster response
 */
export async function quickNetworkCheck(): Promise<boolean> {
    return await reliableNetworkCheck(1500);
}

/**
 * **NEW: VPN Detection and Monitoring**
 * Detects if VPN connections are active, with specific support for GlobalProtect
 */

export interface VPNStatus {
    isConnected: boolean;
    vpnType?: 'globalprotect' | 'openvpn' | 'l2tp' | 'pptp' | 'other';
    connectionName?: string;
    serverAddress?: string;
    lastChecked: Date;
    error?: string;
}

/**
 * Detect GlobalProtect VPN status on macOS
 */
async function detectGlobalProtectVPN(): Promise<Partial<VPNStatus>> {
    try {
        // Method 1: Check GlobalProtect process
        try {
            const processResult = await execPromise('pgrep -f "GlobalProtect"', { timeout: 3000 });
            if (processResult.stdout.trim()) {
                if (isDevelopment) console.log('🔍 [VPN] GlobalProtect process detected');
                
                // Method 2: Check network interfaces for GlobalProtect
                try {
                    const ifconfigResult = await execPromise('ifconfig | grep -A2 "gpd\\|utun"', { timeout: 3000 });
                    if (ifconfigResult.stdout.includes('inet')) {
                        if (isDevelopment) console.log('✅ [VPN] GlobalProtect VPN interface active');
                        return {
                            isConnected: true,
                            vpnType: 'globalprotect',
                            connectionName: 'GlobalProtect'
                        };
                    }
                } catch (ifError) {
                    // Process exists but no active interface - might be connecting
                    if (isDevelopment) console.log('⚠️ [VPN] GlobalProtect process found but no active interface');
                }
                
                // Method 3: Check GlobalProtect CLI status if available
                try {
                    const gpResult = await execPromise('/Applications/GlobalProtect.app/Contents/MacOS/GlobalProtect show --status', { timeout: 5000 });
                    if (gpResult.stdout.includes('Connected')) {
                        if (isDevelopment) console.log('✅ [VPN] GlobalProtect CLI reports connected');
                        return {
                            isConnected: true,
                            vpnType: 'globalprotect',
                            connectionName: 'GlobalProtect'
                        };
                    }
                } catch (cliError) {
                    // CLI not available or not responding
                    if (isDevelopment) console.log('⚠️ [VPN] GlobalProtect CLI not available');
                }
            }
        } catch (processError) {
            // GlobalProtect process not running
            if (isDevelopment) console.log('ℹ️ [VPN] GlobalProtect process not detected');
        }
        
        return { isConnected: false };
    } catch (error) {
        if (isDevelopment) console.warn('⚠️ [VPN] Error detecting GlobalProtect:', error);
        return { isConnected: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Detect other common VPN types on macOS
 */
async function detectOtherVPNs(): Promise<Partial<VPNStatus>> {
    try {
        // Check for VPN interfaces using system configuration
        const scutilResult = await execPromise('scutil --nwi | grep -E "(VPN|utun|ppp)"', { timeout: 3000 });
        if (scutilResult.stdout.trim()) {
            if (isDevelopment) console.log('✅ [VPN] Other VPN interface detected');
            
            // Try to identify VPN type from interface names
            const output = scutilResult.stdout.toLowerCase();
            if (output.includes('utun')) {
                return {
                    isConnected: true,
                    vpnType: 'other',
                    connectionName: 'VPN (utun interface)'
                };
            } else if (output.includes('ppp')) {
                return {
                    isConnected: true,
                    vpnType: 'pptp',
                    connectionName: 'PPTP VPN'
                };
            }
            
            return {
                isConnected: true,
                vpnType: 'other',
                connectionName: 'Unknown VPN'
            };
        }
        
        return { isConnected: false };
    } catch (error) {
        if (isDevelopment) console.log('ℹ️ [VPN] No other VPN interfaces detected');
        return { isConnected: false };
    }
}

/**
 * Comprehensive VPN status detection
 */
export async function detectVPNStatus(): Promise<VPNStatus> {
    const startTime = Date.now();
    
    try {
        if (isDevelopment) console.log('🔍 [VPN] Starting VPN detection...');
        
        // Check GlobalProtect first (most common in enterprise environments)
        const globalProtectStatus = await detectGlobalProtectVPN();
        if (globalProtectStatus.isConnected) {
            const result: VPNStatus = {
                isConnected: true,
                vpnType: globalProtectStatus.vpnType || 'globalprotect',
                connectionName: globalProtectStatus.connectionName,
                serverAddress: globalProtectStatus.serverAddress,
                lastChecked: new Date()
            };
            
            if (isDevelopment) {
                const duration = Date.now() - startTime;
                console.log(`✅ [VPN] GlobalProtect VPN detected (${duration}ms)`, result);
            }
            
            return result;
        }
        
        // Check for other VPN types
        const otherVPNStatus = await detectOtherVPNs();
        if (otherVPNStatus.isConnected) {
            const result: VPNStatus = {
                isConnected: true,
                vpnType: otherVPNStatus.vpnType || 'other',
                connectionName: otherVPNStatus.connectionName,
                lastChecked: new Date()
            };
            
            if (isDevelopment) {
                const duration = Date.now() - startTime;
                console.log(`✅ [VPN] Other VPN detected (${duration}ms)`, result);
            }
            
            return result;
        }
        
        // No VPN detected
        const result: VPNStatus = {
            isConnected: false,
            lastChecked: new Date()
        };
        
        if (isDevelopment) {
            const duration = Date.now() - startTime;
            console.log(`ℹ️ [VPN] No VPN detected (${duration}ms)`);
        }
        
        return result;
        
    } catch (error) {
        const result: VPNStatus = {
            isConnected: false,
            lastChecked: new Date(),
            error: error instanceof Error ? error.message : String(error)
        };
        
        if (isDevelopment) {
            console.warn('⚠️ [VPN] VPN detection failed:', error);
        }
        
        return result;
    }
}

/**
 * **NEW: Enhanced server connectivity check with VPN awareness**
 * Includes shorter timeouts and VPN-aware error messages
 */
export async function checkServerConnectivityWithVPN(
    serverName: string, 
    timeoutMs: number = 3000,
    vpnStatus?: VPNStatus
): Promise<{
    accessible: boolean;
    method?: string;
    error?: string;
    vpnRequired?: boolean;
}> {
    try {
        if (isDevelopment) console.log(`🔍 [ServerCheck] Checking connectivity to ${serverName} (timeout: ${timeoutMs}ms)`);
        
        // Quick ping test with short timeout
        try {
            await execPromise(`ping -c 1 -W 1000 "${serverName}"`, { timeout: Math.min(timeoutMs, 3000) });
            if (isDevelopment) console.log(`✅ [ServerCheck] ${serverName} reachable via ping`);
            return { accessible: true, method: 'ping' };
        } catch (pingError) {
            if (isDevelopment) console.log(`⚠️ [ServerCheck] Ping failed for ${serverName}`);
        }
        
        // Try SMB port check with very short timeout
        try {
            await execPromise(`nc -z -w 1 "${serverName}" 445`, { timeout: 2000 });
            if (isDevelopment) console.log(`✅ [ServerCheck] ${serverName} SMB port 445 accessible`);
            return { accessible: true, method: 'SMB port check' };
        } catch (ncError) {
            if (isDevelopment) console.log(`⚠️ [ServerCheck] SMB port check failed for ${serverName}`);
        }
        
        // Try DNS resolution only
        try {
            await execPromise(`host "${serverName}"`, { timeout: 2000 });
            if (isDevelopment) console.log(`✅ [ServerCheck] ${serverName} DNS resolution successful`);
            
            // DNS works but server not reachable - likely VPN issue
            const vpnRequired = vpnStatus ? !vpnStatus.isConnected : true;
            return {
                accessible: false,
                method: 'DNS only',
                error: vpnRequired ? 
                    `Server ${serverName} resolved via DNS but not reachable. VPN connection may be required.` :
                    `Server ${serverName} not responding to connection attempts.`,
                vpnRequired
            };
        } catch (dnsError) {
            if (isDevelopment) console.log(`❌ [ServerCheck] DNS resolution failed for ${serverName}`);
        }
        
        // All checks failed
        const vpnRequired = vpnStatus ? !vpnStatus.isConnected : true;
        return {
            accessible: false,
            error: vpnRequired ? 
                `Server ${serverName} not accessible. VPN connection may be required.` :
                `Server ${serverName} not accessible via any method.`,
            vpnRequired
        };
        
    } catch (error) {
        return {
            accessible: false,
            error: `Connectivity check failed: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * **NEW: Quick VPN-aware connectivity pre-check**
 * Fast check to determine if mounting should be attempted
 */
export async function quickVPNAwareConnectivityCheck(serverName: string): Promise<{
    shouldAttemptMount: boolean;
    reason: string;
    vpnStatus: VPNStatus;
}> {
    try {
        // Quick VPN status check
        const vpnStatus = await detectVPNStatus();
        
        // If VPN is connected, proceed with mount attempt
        if (vpnStatus.isConnected) {
            return {
                shouldAttemptMount: true,
                reason: `VPN (${vpnStatus.connectionName}) is connected`,
                vpnStatus
            };
        }
        
        // VPN not connected - do quick server check
        const connectivity = await checkServerConnectivityWithVPN(serverName, 2000, vpnStatus);
        
        if (connectivity.accessible) {
            return {
                shouldAttemptMount: true,
                reason: `Server ${serverName} accessible without VPN`,
                vpnStatus
            };
        } else if (connectivity.vpnRequired) {
            return {
                shouldAttemptMount: false,
                reason: `Server ${serverName} requires VPN connection`,
                vpnStatus
            };
        } else {
            return {
                shouldAttemptMount: false,
                reason: connectivity.error || `Server ${serverName} not accessible`,
                vpnStatus
            };
        }
        
    } catch (error) {
        // On error, assume VPN might be required
        return {
            shouldAttemptMount: false,
            reason: `Cannot determine connectivity: ${error instanceof Error ? error.message : String(error)}`,
            vpnStatus: { isConnected: false, lastChecked: new Date() }
        };
    }
}
