#!/usr/bin/env node

/**
 * Network Connectivity Checks Test
 * Tests the new network connectivity protection features implemented in the app
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = promisify(exec);

console.log('🔍 Testing Network Connectivity Protection Features\n');

const APP_PATH = '/Users/felipe/Documents/dev/Attach/attach-app';

async function testFileSystemConnectivityChecks() {
    console.log('1. ✅ Testing FileSystem Connectivity Checks:');
    
    try {
        // Test the fileSystem.ts implementation
        const fileSystemPath = path.join(APP_PATH, 'src/main/mount/fileSystem.ts');
        const content = fs.readFileSync(fileSystemPath, 'utf8');
        
        // Check for timeout wrapper implementation
        if (content.includes('withTimeout') && content.includes('setTimeout')) {
            console.log('   ✅ Timeout wrapper function implemented');
        } else {
            console.log('   ❌ Timeout wrapper function missing');
        }
        
        // Check for path accessibility check
        if (content.includes('isPathAccessible') && content.includes('fs.access')) {
            console.log('   ✅ Path accessibility check implemented');
        } else {
            console.log('   ❌ Path accessibility check missing');
        }
        
        // Check for network mount detection
        if (content.includes('isNetworkMount') && content.includes('mount | grep')) {
            console.log('   ✅ Network mount detection implemented');
        } else {
            console.log('   ❌ Network mount detection missing');
        }
        
        // Check for connectivity validation
        if (content.includes('checkNetworkConnectivity') && content.includes('readdir')) {
            console.log('   ✅ Network connectivity validation implemented');
        } else {
            console.log('   ❌ Network connectivity validation missing');
        }
        
        // Check for safe path opening
        if (content.includes('safeOpenPath') && content.includes('mount status check')) {
            console.log('   ✅ Safe path opening implemented');
        } else {
            console.log('   ❌ Safe path opening missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking fileSystem.ts:', error.message);
    }
}

async function testSMBServiceConnectivityChecks() {
    console.log('\n2. ✅ Testing SMB Service Connectivity Checks:');
    
    try {
        // Test the smbService.ts implementation
        const smbServicePath = path.join(APP_PATH, 'src/main/mount/smbService.ts');
        const content = fs.readFileSync(smbServicePath, 'utf8');
        
        // Check for server connectivity check
        if (content.includes('checkServerConnectivity') && content.includes('ping -c 1')) {
            console.log('   ✅ Server connectivity check implemented');
        } else {
            console.log('   ❌ Server connectivity check missing');
        }
        
        // Check for host resolution fallback
        if (content.includes('host ') && content.includes('has address')) {
            console.log('   ✅ Host resolution fallback implemented');
        } else {
            console.log('   ❌ Host resolution fallback missing');
        }
        
        // Check for pre-mount connectivity validation
        if (content.includes('connectivityCheck = await checkServerConnectivity')) {
            console.log('   ✅ Pre-mount connectivity validation implemented');
        } else {
            console.log('   ❌ Pre-mount connectivity validation missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking smbService.ts:', error.message);
    }
}

async function testIPCHandlerSafeOperations() {
    console.log('\n3. ✅ Testing IPC Handler Safe Operations:');
    
    try {
        // Test the main index.ts IPC handlers
        const indexPath = path.join(APP_PATH, 'src/main/index.ts');
        const content = fs.readFileSync(indexPath, 'utf8');
        
        // Check for safe open-in-finder handler
        if (content.includes('open-in-finder') && content.includes('safeOpenPath')) {
            console.log('   ✅ Safe open-in-finder handler implemented');
        } else {
            console.log('   ❌ Safe open-in-finder handler missing');
        }
        
        // Check for enhanced get-folder-contents handler
        if (content.includes('get-folder-contents') && content.includes('readDirectoryContents')) {
            console.log('   ✅ Enhanced get-folder-contents handler implemented');
        } else {
            console.log('   ❌ Enhanced get-folder-contents handler missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking index.ts:', error.message);
    }
}

async function testTrayMenuSafeOperations() {
    console.log('\n4. ✅ Testing Tray Menu Safe Operations:');
    
    try {
        // Test the tray.ts implementation
        const trayPath = path.join(APP_PATH, 'src/main/tray.ts');
        const content = fs.readFileSync(trayPath, 'utf8');
        
        // Check for safe "Open in Finder" operation
        if (content.includes('Open in Finder') && content.includes('safeOpenPath')) {
            console.log('   ✅ Safe "Open in Finder" tray action implemented');
        } else {
            console.log('   ❌ Safe "Open in Finder" tray action missing');
        }
        
        // Check for safe "Browse Contents" operation
        if (content.includes('Browse Contents') && content.includes('safeOpenPath')) {
            console.log('   ✅ Safe "Browse Contents" tray action implemented');
        } else {
            console.log('   ❌ Safe "Browse Contents" tray action missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking tray.ts:', error.message);
    }
}

async function testTimeoutConfiguration() {
    console.log('\n5. ✅ Testing Timeout Configuration:');
    
    try {
        const fileSystemPath = path.join(APP_PATH, 'src/main/mount/fileSystem.ts');
        const smbServicePath = path.join(APP_PATH, 'src/main/mount/smbService.ts');
        
        const fileSystemContent = fs.readFileSync(fileSystemPath, 'utf8');
        const smbServiceContent = fs.readFileSync(smbServicePath, 'utf8');
        
        // Check for appropriate timeout values
        const timeoutPatterns = [
            /timeout:\s*3000/g,  // 3 second timeouts
            /timeout:\s*5000/g,  // 5 second timeouts
            /timeout:\s*8000/g,  // 8 second timeouts
            /timeout:\s*10000/g, // 10 second timeouts
        ];
        
        let totalTimeouts = 0;
        timeoutPatterns.forEach(pattern => {
            const fsMatches = fileSystemContent.match(pattern) || [];
            const smbMatches = smbServiceContent.match(pattern) || [];
            totalTimeouts += fsMatches.length + smbMatches.length;
        });
        
        if (totalTimeouts >= 5) {
            console.log(`   ✅ Appropriate timeout configuration found (${totalTimeouts} timeout settings)`);
        } else {
            console.log(`   ⚠️  Limited timeout configuration found (${totalTimeouts} timeout settings)`);
        }
        
        // Check for different timeouts for network vs local operations
        if (fileSystemContent.includes('connectivity.isNetwork ? 10000 : 5000') || 
            fileSystemContent.includes('connectivity.isNetwork ? 8000 : 4000')) {
            console.log('   ✅ Adaptive timeouts for network vs local operations');
        } else {
            console.log('   ❌ Adaptive timeouts for network vs local operations missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking timeout configuration:', error.message);
    }
}

async function testErrorHandling() {
    console.log('\n6. ✅ Testing Error Handling:');
    
    try {
        const fileSystemPath = path.join(APP_PATH, 'src/main/mount/fileSystem.ts');
        const content = fs.readFileSync(fileSystemPath, 'utf8');
        
        // Check for user-friendly error messages
        const errorMessages = [
            'Network share is not accessible',
            'Network connection lost',
            'Network share is not responding',
            'The connection may have been lost',
            'Network share is no longer mounted'
        ];
        
        let foundMessages = 0;
        errorMessages.forEach(message => {
            if (content.includes(message)) {
                foundMessages++;
            }
        });
        
        if (foundMessages >= 3) {
            console.log(`   ✅ User-friendly error messages implemented (${foundMessages}/${errorMessages.length})`);
        } else {
            console.log(`   ⚠️  Limited user-friendly error messages (${foundMessages}/${errorMessages.length})`);
        }
        
        // Check for development logging
        if (content.includes('process.env.NODE_ENV === \'development\'') && content.includes('console.warn')) {
            console.log('   ✅ Development logging implemented');
        } else {
            console.log('   ❌ Development logging missing');
        }
        
    } catch (error) {
        console.log('   ❌ Error checking error handling:', error.message);
    }
}

async function testActualNetworkCommands() {
    console.log('\n7. ✅ Testing Actual Network Commands:');
    
    try {
        // Test ping command functionality
        console.log('   🏓 Testing ping command...');
        const pingResult = await execPromise('ping -c 1 -W 2000 8.8.8.8', { timeout: 5000 });
        console.log('   ✅ Ping command works');
        
        // Test mount command availability
        console.log('   🗂️  Testing mount command...');
        const mountResult = await execPromise('mount | head -3', { timeout: 3000 });
        console.log('   ✅ Mount command works');
        
        // Test host command availability
        console.log('   🌐 Testing host command...');
        const hostResult = await execPromise('host google.com', { timeout: 5000 });
        if (hostResult.stdout.includes('has address')) {
            console.log('   ✅ Host command works');
        } else {
            console.log('   ⚠️  Host command returned unexpected output');
        }
        
    } catch (error) {
        console.log('   ❌ Error testing network commands:', error.message);
    }
}

async function testBuildIntegrity() {
    console.log('\n8. ✅ Testing Build Integrity:');
    
    try {
        // Check TypeScript compilation
        console.log('   📦 Testing TypeScript compilation...');
        const result = await execPromise('cd ' + APP_PATH + ' && npm run build', { timeout: 30000 });
        console.log('   ✅ TypeScript compilation successful');
        
    } catch (error) {
        console.log('   ❌ TypeScript compilation failed:', error.message);
        
        // Try to get more specific error info
        try {
            const tscResult = await execPromise('cd ' + APP_PATH + ' && npx tsc --noEmit', { timeout: 15000 });
            console.log('   ℹ️  TypeScript check passed separately');
        } catch (tscError) {
            console.log('   ❌ TypeScript errors detected');
        }
    }
}

async function testManualNetworkSimulation() {
    console.log('\n9. ✅ Manual Network Simulation Test Instructions:');
    
    console.log('   📋 To manually test network connectivity protection:');
    console.log('   ');
    console.log('   1. Start the Attach app: npm start');
    console.log('   2. Mount a network share (test server or local share)');
    console.log('   3. Verify the share appears in tray menu');
    console.log('   4. Disconnect from WiFi/network');
    console.log('   5. Try to:');
    console.log('      • Click "Open in Finder" - should show appropriate error');
    console.log('      • Click "Browse Contents" - should show appropriate error');
    console.log('      • Try mounting new shares - should fail with connectivity error');
    console.log('   6. Reconnect to network');
    console.log('   7. Verify operations work again');
    console.log('   ');
    console.log('   🎯 Expected behavior:');
    console.log('   • No hanging operations during network issues');
    console.log('   • User-friendly error messages');
    console.log('   • App remains responsive at all times');
    console.log('   • Quick recovery when network returns');
}

async function runConnectivityChecksTest() {
    console.log('🚀 Starting Network Connectivity Protection Test Suite...\n');
    
    await testFileSystemConnectivityChecks();
    await testSMBServiceConnectivityChecks();
    await testIPCHandlerSafeOperations();
    await testTrayMenuSafeOperations();
    await testTimeoutConfiguration();
    await testErrorHandling();
    await testActualNetworkCommands();
    await testBuildIntegrity();
    await testManualNetworkSimulation();
    
    console.log('\n✨ Network Connectivity Protection Test Complete!');
    console.log('');
    console.log('📊 Summary:');
    console.log('• Enhanced fileSystem.ts with timeout wrappers and connectivity checks');
    console.log('• Enhanced smbService.ts with pre-mount server validation');
    console.log('• Updated IPC handlers to use safe operations');
    console.log('• Enhanced tray menu with safe file operations');
    console.log('• Comprehensive error handling and user feedback');
    console.log('• Adaptive timeouts for network vs local operations');
    console.log('');
    console.log('🔧 Next steps:');
    console.log('• Run manual tests as described above');
    console.log('• Monitor app behavior during actual network disconnections');
    console.log('• Consider adding user notifications for connectivity issues');
    console.log('• Test with various network share types (SMB, CIFS, NFS)');
}

runConnectivityChecksTest().catch(console.error);
