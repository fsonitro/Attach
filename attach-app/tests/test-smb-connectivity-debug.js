#!/usr/bin/env node

/**
 * SMB Connectivity Debug Test
 * Tests the exact SMB connectivity flow to identify issues
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execPromise = promisify(exec);

console.log('🔍 SMB Connectivity Debug Test\n');

async function testBasicNetworkCommands() {
    console.log('1. Testing Basic Network Commands:');
    console.log('─'.repeat(40));
    
    // Test ping command
    try {
        const result = await execPromise('ping -c 1 -W 2000 8.8.8.8', { timeout: 5000 });
        console.log('   ✅ Internet connectivity: WORKING');
    } catch (error) {
        console.log('   ❌ Internet connectivity: FAILED -', error.message.split('\n')[0]);
    }
    
    // Test host command
    try {
        await execPromise('host google.com', { timeout: 3000 });
        console.log('   ✅ DNS resolution: WORKING');
    } catch (error) {
        console.log('   ❌ DNS resolution: FAILED -', error.message.split('\n')[0]);
    }
    
    // Test mount command
    try {
        await execPromise('mount | grep -E "(smbfs|cifs)" || echo "No SMB mounts"', { timeout: 3000 });
        console.log('   ✅ Mount command: WORKING');
    } catch (error) {
        console.log('   ❌ Mount command: FAILED -', error.message.split('\n')[0]);
    }
    
    // Test smbutil command
    try {
        await execPromise('which smbutil', { timeout: 3000 });
        console.log('   ✅ SMB utilities: AVAILABLE');
    } catch (error) {
        console.log('   ❌ SMB utilities: NOT AVAILABLE -', error.message.split('\n')[0]);
    }
    
    // Test mount_smbfs command
    try {
        await execPromise('which mount_smbfs', { timeout: 3000 });
        console.log('   ✅ SMB mount command: AVAILABLE');
    } catch (error) {
        console.log('   ❌ SMB mount command: NOT AVAILABLE -', error.message.split('\n')[0]);
    }
}

async function testServerConnectivityFunction() {
    console.log('\n2. Testing Server Connectivity Function Logic:');
    console.log('─'.repeat(40));
    
    // Test with a known good server (localhost)
    console.log('\n   Testing with localhost...');
    try {
        const pingResult = await execPromise('ping -c 1 -W 5 "localhost"', { timeout: 5000 });
        if (pingResult.stdout.includes('1 packets transmitted, 1 received')) {
            console.log('   ✅ Localhost ping: SUCCESS');
        } else {
            console.log('   ❌ Localhost ping: FAILED - unexpected output');
        }
    } catch (error) {
        console.log('   ❌ Localhost ping: FAILED -', error.message.split('\n')[0]);
        
        // Fallback to host resolution test
        try {
            const hostResult = await execPromise('host "localhost"', { timeout: 3000 });
            if (hostResult.stdout.includes('has address') || hostResult.stdout.includes('has IPv6')) {
                console.log('   ✅ Localhost host resolution: SUCCESS (fallback)');
            } else {
                console.log('   ❌ Localhost host resolution: FAILED - unexpected output');
            }
        } catch (hostError) {
            console.log('   ❌ Localhost host resolution: FAILED -', hostError.message.split('\n')[0]);
        }
    }
    
    // Test with an unreachable server
    console.log('\n   Testing with unreachable server...');
    try {
        const pingResult = await execPromise('ping -c 1 -W 2 "192.168.255.255"', { timeout: 3000 });
        console.log('   ⚠️  Unreachable server ping: unexpectedly succeeded');
    } catch (error) {
        console.log('   ✅ Unreachable server ping: correctly failed');
        
        // Test fallback host resolution
        try {
            await execPromise('host "192.168.255.255"', { timeout: 3000 });
            console.log('   ⚠️  Unreachable server host resolution: unexpectedly succeeded');
        } catch (hostError) {
            console.log('   ✅ Unreachable server host resolution: correctly failed');
        }
    }
}

async function testTypeScriptImports() {
    console.log('\n3. Testing TypeScript Import and Compilation:');
    console.log('─'.repeat(40));
    
    try {
        // Check if our networkNotifications import is working
        const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
        const result = await execPromise('npx tsc --noEmit --skipLibCheck src/main/mount/smbService.ts', {
            cwd: appPath,
            timeout: 15000
        });
        console.log('   ✅ SMB Service TypeScript compilation: SUCCESS');
    } catch (error) {
        console.log('   ❌ SMB Service TypeScript compilation: FAILED');
        console.log('       Error:', error.message.split('\n')[0]);
    }
    
    try {
        const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
        const result = await execPromise('npx tsc --noEmit --skipLibCheck src/main/mount/fileSystem.ts', {
            cwd: appPath,
            timeout: 15000
        });
        console.log('   ✅ File System TypeScript compilation: SUCCESS');
    } catch (error) {
        console.log('   ❌ File System TypeScript compilation: FAILED');
        console.log('       Error:', error.message.split('\n')[0]);
    }
}

async function testActualSMBConnection() {
    console.log('\n4. Testing Actual SMB Connection Attempt:');
    console.log('─'.repeat(40));
    
    console.log('   💡 To test actual SMB connection, we need server details.');
    console.log('   💡 Common test cases:');
    console.log('      • Test server availability check');
    console.log('      • Test authentication flow');
    console.log('      • Test mount command syntax');
    
    // Test mount command syntax (without actually mounting)
    console.log('\n   Testing mount command syntax...');
    try {
        // This should fail but with a specific error indicating the command syntax is correct
        const result = await execPromise('mount_smbfs //test@nonexistent.local/share /tmp/test-mount-point 2>&1 || true', { timeout: 5000 });
        
        if (result.stdout.includes('No such file or directory') || 
            result.stdout.includes('could not connect') ||
            result.stdout.includes('No route to host')) {
            console.log('   ✅ Mount command syntax: CORRECT (expected failure)');
        } else {
            console.log('   ⚠️  Mount command: unexpected output -', result.stdout.split('\n')[0]);
        }
    } catch (error) {
        console.log('   ❌ Mount command test: FAILED -', error.message.split('\n')[0]);
    }
}

async function runSMBConnectivityDebugTest() {
    try {
        await testBasicNetworkCommands();
        await testServerConnectivityFunction();
        await testTypeScriptImports();
        await testActualSMBConnection();
        
        console.log('\n📋 Debug Test Summary:');
        console.log('─'.repeat(40));
        console.log('If all tests above show ✅, the SMB connectivity functions should work.');
        console.log('If you\'re still having connection issues, the problem might be:');
        console.log('   1. Network configuration on your machine');
        console.log('   2. Specific server/share settings');
        console.log('   3. Authentication credentials');
        console.log('   4. Firewall or security settings');
        
        console.log('\n✅ SMB connectivity debug test completed!');
        
    } catch (error) {
        console.error('❌ Debug test failed:', error);
    }
}

runSMBConnectivityDebugTest().catch(console.error);
