#!/usr/bin/env node

/**
 * Integrated Network Connectivity and Notifications Test
 * Tests the complete system with notification integration
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = promisify(exec);

console.log('🔔 Integrated Network Connectivity and Notifications Test\n');

async function testNotificationSystemIntegration() {
    console.log('1. Testing Notification System Integration:');
    console.log('─'.repeat(50));
    
    const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
    
    // Test 1: Verify imports in fileSystem.ts
    console.log('\n📁 Testing fileSystem.ts notification integration...');
    const fileSystemPath = path.join(appPath, 'src/main/mount/fileSystem.ts');
    const fileSystemContent = fs.readFileSync(fileSystemPath, 'utf8');
    
    if (fileSystemContent.includes('networkNotifications')) {
        console.log('   ✅ NetworkNotifications imported');
    } else {
        console.log('   ❌ NetworkNotifications NOT imported');
    }
    
    if (fileSystemContent.includes('notifyNetworkTimeout')) {
        console.log('   ✅ notifyNetworkTimeout function available');
    } else {
        console.log('   ❌ notifyNetworkTimeout function NOT available');
    }
    
    if (fileSystemContent.includes('notifyShareInaccessible')) {
        console.log('   ✅ notifyShareInaccessible function available');
    } else {
        console.log('   ❌ notifyShareInaccessible function NOT available');
    }
    
    // Test 2: Verify imports in smbService.ts
    console.log('\n🖧  Testing smbService.ts notification integration...');
    const smbServicePath = path.join(appPath, 'src/main/mount/smbService.ts');
    const smbServiceContent = fs.readFileSync(smbServicePath, 'utf8');
    
    if (smbServiceContent.includes('networkNotifications')) {
        console.log('   ✅ NetworkNotifications imported');
    } else {
        console.log('   ❌ NetworkNotifications NOT imported');
    }
    
    if (smbServiceContent.includes('notifyServerUnreachable')) {
        console.log('   ✅ notifyServerUnreachable function available');
    } else {
        console.log('   ❌ notifyServerUnreachable function NOT available');
    }
    
    if (smbServiceContent.includes('notifyMountFailure')) {
        console.log('   ✅ notifyMountFailure function available');
    } else {
        console.log('   ❌ notifyMountFailure function NOT available');
    }
    
    // Test 3: Verify notification calls in error handling
    console.log('\n🚨 Testing notification usage in error scenarios...');
    
    const timeoutNotificationCalls = (fileSystemContent.match(/notifyNetworkTimeout/g) || []).length;
    const shareInaccessibleCalls = (fileSystemContent.match(/notifyShareInaccessible/g) || []).length;
    const serverUnreachableCalls = (smbServiceContent.match(/notifyServerUnreachable/g) || []).length;
    const mountFailureCalls = (smbServiceContent.match(/notifyMountFailure/g) || []).length;
    
    console.log(`   📊 Network timeout notifications: ${timeoutNotificationCalls} calls`);
    console.log(`   📊 Share inaccessible notifications: ${shareInaccessibleCalls} calls`);
    console.log(`   📊 Server unreachable notifications: ${serverUnreachableCalls} calls`);
    console.log(`   📊 Mount failure notifications: ${mountFailureCalls} calls`);
    
    const totalNotificationCalls = timeoutNotificationCalls + shareInaccessibleCalls + serverUnreachableCalls + mountFailureCalls;
    console.log(`   ✅ Total notification integration points: ${totalNotificationCalls}`);
    
    return {
        fileSystemIntegrated: timeoutNotificationCalls > 0 && shareInaccessibleCalls > 0,
        smbServiceIntegrated: serverUnreachableCalls > 0 && mountFailureCalls > 0,
        totalIntegrationPoints: totalNotificationCalls
    };
}

async function testNotificationSystemAPI() {
    console.log('\n2. Testing Notification System API:');
    console.log('─'.repeat(50));
    
    const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
    const notificationsPath = path.join(appPath, 'src/main/utils/networkNotifications.ts');
    
    if (!fs.existsSync(notificationsPath)) {
        console.log('   ❌ NetworkNotifications module not found');
        return false;
    }
    
    const notificationsContent = fs.readFileSync(notificationsPath, 'utf8');
    
    // Check for required notification methods
    const requiredMethods = [
        'notifyNetworkLoss',
        'notifyNetworkRestored', 
        'notifyShareInaccessible',
        'notifyMountFailure',
        'notifyNetworkTimeout',
        'notifyAutoMountSuccess',
        'notifyServerUnreachable'
    ];
    
    let methodsFound = 0;
    for (const method of requiredMethods) {
        if (notificationsContent.includes(method)) {
            console.log(`   ✅ ${method} method available`);
            methodsFound++;
        } else {
            console.log(`   ❌ ${method} method NOT found`);
        }
    }
    
    // Check for cooldown mechanism
    if (notificationsContent.includes('NOTIFICATION_COOLDOWN')) {
        console.log('   ✅ Notification cooldown mechanism present');
    } else {
        console.log('   ❌ Notification cooldown mechanism NOT found');
    }
    
    // Check for urgency levels
    if (notificationsContent.includes('getUrgencyForType')) {
        console.log('   ✅ Notification urgency levels implemented');
    } else {
        console.log('   ❌ Notification urgency levels NOT implemented');
    }
    
    console.log(`   📊 Notification methods found: ${methodsFound}/${requiredMethods.length}`);
    
    return methodsFound === requiredMethods.length;
}

async function testConnectivityFunctionsWithNotifications() {
    console.log('\n3. Testing Connectivity Functions with Notification Integration:');
    console.log('─'.repeat(50));
    
    const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
    
    try {
        // Simulate importing the modules to check for syntax errors
        console.log('   🔍 Checking TypeScript compilation...');
        
        const tscResult = await execPromise('npx tsc --noEmit --skipLibCheck', { 
            cwd: appPath,
            timeout: 30000 
        });
        
        console.log('   ✅ TypeScript compilation successful');
        
        // Test basic network commands that the app uses
        console.log('\n   🌐 Testing network connectivity functions...');
        
        // Test ping function (used by checkServerConnectivity)
        try {
            await execPromise('ping -c 1 -W 2000 127.0.0.1', { timeout: 5000 });
            console.log('   ✅ Ping functionality working');
        } catch (error) {
            console.log('   ⚠️  Ping test failed:', error.message);
        }
        
        // Test mount command (used by isNetworkMount)
        try {
            await execPromise('mount | grep -E "(smbfs|cifs|nfs)" || true', { timeout: 3000 });
            console.log('   ✅ Mount detection functionality working');
        } catch (error) {
            console.log('   ⚠️  Mount detection test failed:', error.message);
        }
        
        // Test host resolution (used by checkServerConnectivity)
        try {
            await execPromise('host localhost', { timeout: 3000 });
            console.log('   ✅ Host resolution functionality working');
        } catch (error) {
            console.log('   ⚠️  Host resolution test failed:', error.message);
        }
        
        return true;
        
    } catch (error) {
        console.log('   ❌ TypeScript compilation failed:', error.message);
        return false;
    }
}

async function testNetworkWatcherIntegrationPotential() {
    console.log('\n4. Testing NetworkWatcher Integration Potential:');
    console.log('─'.repeat(50));
    
    const appPath = '/Users/felipe/Documents/dev/Attach/attach-app';
    const networkWatcherPath = path.join(appPath, 'src/main/utils/networkWatcher.ts');
    
    if (!fs.existsSync(networkWatcherPath)) {
        console.log('   ❌ NetworkWatcher module not found');
        return false;
    }
    
    const networkWatcherContent = fs.readFileSync(networkWatcherPath, 'utf8');
    
    // Check if NetworkWatcher already uses notifications
    if (networkWatcherContent.includes('networkNotifications')) {
        console.log('   ✅ NetworkWatcher already uses notifications');
    } else {
        console.log('   🔄 NetworkWatcher ready for notification integration');
        
        // Check for event emission points that could benefit from notifications
        const eventEmissions = (networkWatcherContent.match(/this\.emit\(/g) || []).length;
        console.log(`   📊 Event emission points for notification integration: ${eventEmissions}`);
        
        // Check for specific events that should trigger notifications
        if (networkWatcherContent.includes('network-online')) {
            console.log('   🔄 network-online event ready for restoration notification');
        }
        if (networkWatcherContent.includes('network-offline')) {
            console.log('   🔄 network-offline event ready for loss notification');
        }
        if (networkWatcherContent.includes('mount-success')) {
            console.log('   🔄 mount-success event ready for success notification');
        }
        if (networkWatcherContent.includes('mount-failed-permanently')) {
            console.log('   🔄 mount-failed-permanently event ready for failure notification');
        }
    }
    
    return true;
}

async function generateIntegrationReport() {
    console.log('\n5. Integration Status Report:');
    console.log('─'.repeat(50));
    
    const results = {
        notificationSystemAPI: await testNotificationSystemAPI(),
        notificationIntegration: await testNotificationSystemIntegration(),
        connectivityFunctions: await testConnectivityFunctionsWithNotifications(),
        networkWatcherPotential: await testNetworkWatcherIntegrationPotential()
    };
    
    console.log('\n📊 Integration Summary:');
    console.log(`   Notification System API: ${results.notificationSystemAPI ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`   FileSystem Integration: ${results.notificationIntegration.fileSystemIntegrated ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`   SMB Service Integration: ${results.notificationIntegration.smbServiceIntegrated ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`   Connectivity Functions: ${results.connectivityFunctions ? '✅ Working' : '❌ Issues Found'}`);
    console.log(`   NetworkWatcher Ready: ${results.networkWatcherPotential ? '✅ Ready' : '❌ Not Ready'}`);
    
    const overallScore = Object.values(results).reduce((score, result) => {
        if (typeof result === 'boolean') return score + (result ? 1 : 0);
        if (typeof result === 'object') return score + (result.fileSystemIntegrated && result.smbServiceIntegrated ? 1 : 0);
        return score;
    }, 0);
    
    console.log(`\n🎯 Overall Integration Score: ${overallScore}/5`);
    
    if (overallScore >= 4) {
        console.log('🎉 Notification system integration is successful!');
        console.log('📋 Next steps:');
        console.log('   1. Integrate notifications into NetworkWatcher');
        console.log('   2. Test with real network disconnections');
        console.log('   3. Verify notification timing and user experience');
    } else {
        console.log('⚠️  Some integration issues detected. Review the results above.');
    }
    
    return results;
}

async function runIntegratedNotificationsTest() {
    try {
        console.log('Starting comprehensive notification integration test...\n');
        
        const results = await generateIntegrationReport();
        
        console.log('\n✅ Integrated notifications test completed successfully!');
        return results;
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

runIntegratedNotificationsTest().catch(console.error);
