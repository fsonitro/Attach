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
