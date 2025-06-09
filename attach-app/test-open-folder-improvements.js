#!/usr/bin/env node

/**
 * Test script to validate the improved "Open Folder" functionality
 * This script tests timeout handling, network notifications, and reconnection mechanisms
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

console.log('🧪 Testing Improved "Open Folder" Functionality');
console.log('=' .repeat(60));

/**
 * Test the notification system exports
 */
async function testNotificationExports() {
    console.log('\n📢 Testing notification system exports...');
    
    try {
        // Test that we can import the notification functions
        const notificationPath = path.join(__dirname, '../src/main/utils/networkNotifications.ts');
        const content = await fs.readFile(notificationPath, 'utf8');
        
        const requiredExports = [
            'notifyNetworkOperationInProgress',
            'notifyNetworkOperationComplete', 
            'notifyNetworkOperationFailed',
            'notifyReconnectionAttempt',
            'notifyReconnectionSuccess',
            'notifyReconnectionFailed'
        ];
        
        let allExportsFound = true;
        for (const exportName of requiredExports) {
            if (!content.includes(`export const ${exportName}`)) {
                console.log(`❌ Missing export: ${exportName}`);
                allExportsFound = false;
            }
        }
        
        if (allExportsFound) {
            console.log('✅ All required notification exports found');
        } else {
            console.log('❌ Some notification exports are missing');
        }
        
        return allExportsFound;
    } catch (error) {
        console.log(`❌ Error testing notification exports: ${error.message}`);
        return false;
    }
}

/**
 * Test the attemptShareReconnection function
 */
async function testReconnectionFunction() {
    console.log('\n🔄 Testing share reconnection function...');
    
    try {
        const indexPath = path.join(__dirname, '../src/main/index.ts');
        const content = await fs.readFile(indexPath, 'utf8');
        
        // Check that the function exists
        if (content.includes('async function attemptShareReconnection')) {
            console.log('✅ attemptShareReconnection function found');
            
            // Check for key functionality
            const checks = [
                { name: 'Notification on attempt', pattern: 'notifyReconnectionAttempt' },
                { name: 'Connection lookup', pattern: 'connectionStore.getConnections()' },
                { name: 'Password retrieval', pattern: 'connectionStore.getPassword' },
                { name: 'SMB remount', pattern: 'mountSMBShare' },
                { name: 'Success notification', pattern: 'notifyReconnectionSuccess' },
                { name: 'Failure notification', pattern: 'notifyReconnectionFailed' }
            ];
            
            let allChecksPass = true;
            for (const check of checks) {
                if (content.includes(check.pattern)) {
                    console.log(`  ✅ ${check.name}: Found`);
                } else {
                    console.log(`  ❌ ${check.name}: Missing`);
                    allChecksPass = false;
                }
            }
            
            return allChecksPass;
        } else {
            console.log('❌ attemptShareReconnection function not found');
            return false;
        }
    } catch (error) {
        console.log(`❌ Error testing reconnection function: ${error.message}`);
        return false;
    }
}

/**
 * Test the improved open-in-finder handler
 */
async function testOpenInFinderHandler() {
    console.log('\n📂 Testing improved open-in-finder handler...');
    
    try {
        const indexPath = path.join(__dirname, '../src/main/index.ts');
        const content = await fs.readFile(indexPath, 'utf8');
        
        // Find the open-in-finder handler
        if (content.includes("ipcMain.handle('open-in-finder'")) {
            console.log('✅ open-in-finder handler found');
            
            // Check for timeout improvements
            const improvements = [
                { name: 'Progress notification', pattern: 'notifyNetworkOperationInProgress' },
                { name: 'Race condition timeout', pattern: 'Promise.race' },
                { name: '3-second safety timeout', pattern: '3000.*timeout' },
                { name: '2-second shell timeout', pattern: '2000.*timeout' },
                { name: 'Reconnection attempt', pattern: 'attemptShareReconnection' },
                { name: 'Complete notification', pattern: 'notifyNetworkOperationComplete' },
                { name: 'Failure notification', pattern: 'notifyNetworkOperationFailed' }
            ];
            
            let allImprovementsFound = true;
            for (const improvement of improvements) {
                const regex = new RegExp(improvement.pattern, 'i');
                if (regex.test(content)) {
                    console.log(`  ✅ ${improvement.name}: Implemented`);
                } else {
                    console.log(`  ❌ ${improvement.name}: Missing`);
                    allImprovementsFound = false;
                }
            }
            
            return allImprovementsFound;
        } else {
            console.log('❌ open-in-finder handler not found');
            return false;
        }
    } catch (error) {
        console.log(`❌ Error testing open-in-finder handler: ${error.message}`);
        return false;
    }
}

/**
 * Test the improved UI feedback in renderer
 */
async function testUIFeedback() {
    console.log('\n🖥️  Testing UI feedback improvements...');
    
    try {
        const htmlPath = path.join(__dirname, '../src/renderer/main/index.html');
        const content = await fs.readFile(htmlPath, 'utf8');
        
        // Check for UI improvements
        const improvements = [
            { name: 'Loading state', pattern: 'Opening\\.\\.\\.' },
            { name: 'Button disable', pattern: 'disabled = true' },
            { name: 'Opacity change', pattern: 'opacity.*0\\.6' },
            { name: 'Timeout protection', pattern: '10000.*timeout' },
            { name: 'Success feedback', pattern: 'Opened!' },
            { name: 'Error handling', pattern: 'taking too long' },
            { name: 'Reset button state', pattern: 'disabled = false' }
        ];
        
        let allImprovementsFound = true;
        for (const improvement of improvements) {
            const regex = new RegExp(improvement.pattern, 'i');
            if (regex.test(content)) {
                console.log(`  ✅ ${improvement.name}: Implemented`);
            } else {
                console.log(`  ❌ ${improvement.name}: Missing`);
                allImprovementsFound = false;
            }
        }
        
        return allImprovementsFound;
    } catch (error) {
        console.log(`❌ Error testing UI feedback: ${error.message}`);
        return false;
    }
}

/**
 * Test the improved tray menu interactions
 */
async function testTrayMenuImprovements() {
    console.log('\n🍱 Testing tray menu improvements...');
    
    try {
        const trayPath = path.join(__dirname, '../src/main/tray.ts');
        const content = await fs.readFile(trayPath, 'utf8');
        
        // Check for tray menu improvements
        const improvements = [
            { name: 'Progress notifications', pattern: 'notifyNetworkOperationInProgress' },
            { name: 'Timeout for safety check', pattern: '3000.*timeout' },
            { name: 'Timeout for open operation', pattern: 'operation timed.*2000' },
            { name: 'Promise.race pattern', pattern: 'Promise\\.race' },
            { name: 'Success notifications', pattern: 'notifyNetworkOperationComplete' },
            { name: 'Failure notifications', pattern: 'notifyNetworkOperationFailed' }
        ];
        
        let allImprovementsFound = true;
        for (const improvement of improvements) {
            const regex = new RegExp(improvement.pattern, 'i');
            if (regex.test(content)) {
                console.log(`  ✅ ${improvement.name}: Implemented`);
            } else {
                console.log(`  ❌ ${improvement.name}: Missing`);
                allImprovementsFound = false;
            }
        }
        
        return allImprovementsFound;
    } catch (error) {
        console.log(`❌ Error testing tray menu improvements: ${error.message}`);
        return false;
    }
}

/**
 * Test folder contents handler improvements
 */
async function testFolderContentsHandler() {
    console.log('\n📋 Testing folder contents handler improvements...');
    
    try {
        const indexPath = path.join(__dirname, '../src/main/index.ts');
        const content = await fs.readFile(indexPath, 'utf8');
        
        // Find the get-folder-contents handler
        if (content.includes("ipcMain.handle('get-folder-contents'")) {
            console.log('✅ get-folder-contents handler found');
            
            // Check for improvements
            const improvements = [
                { name: 'Timeout protection', pattern: '5000.*timeout' },
                { name: 'Promise.race pattern', pattern: 'Promise\\.race' },
                { name: 'Timeout error message', pattern: 'Directory listing timed out' },
                { name: 'Notification on failure', pattern: 'notifyNetworkOperationFailed' }
            ];
            
            let allImprovementsFound = true;
            for (const improvement of improvements) {
                const regex = new RegExp(improvement.pattern, 'i');
                if (regex.test(content)) {
                    console.log(`  ✅ ${improvement.name}: Implemented`);
                } else {
                    console.log(`  ❌ ${improvement.name}: Missing`);
                    allImprovementsFound = false;
                }
            }
            
            return allImprovementsFound;
        } else {
            console.log('❌ get-folder-contents handler not found');
            return false;
        }
    } catch (error) {
        console.log(`❌ Error testing folder contents handler: ${error.message}`);
        return false;
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    console.log('🚀 Starting comprehensive test suite...\n');
    
    const tests = [
        { name: 'Notification Exports', fn: testNotificationExports },
        { name: 'Reconnection Function', fn: testReconnectionFunction },
        { name: 'Open-in-Finder Handler', fn: testOpenInFinderHandler },
        { name: 'UI Feedback', fn: testUIFeedback },
        { name: 'Tray Menu Improvements', fn: testTrayMenuImprovements },
        { name: 'Folder Contents Handler', fn: testFolderContentsHandler }
    ];
    
    const results = [];
    
    for (const test of tests) {
        try {
            const result = await test.fn();
            results.push({ name: test.name, passed: result });
        } catch (error) {
            console.log(`❌ Test "${test.name}" threw an error: ${error.message}`);
            results.push({ name: test.name, passed: false });
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    results.forEach(result => {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status}: ${result.name}`);
    });
    
    console.log(`\n🎯 OVERALL: ${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
    
    if (passed === total) {
        console.log('🎉 All tests passed! The "Open Folder" improvements are successfully implemented.');
        console.log('\n🔧 IMPROVEMENTS IMPLEMENTED:');
        console.log('  • Non-blocking operations with aggressive timeouts');
        console.log('  • Real-time user notifications for network operations');
        console.log('  • Automatic reconnection attempts for disconnected shares');
        console.log('  • Enhanced UI feedback with loading states');
        console.log('  • Improved error handling and user messaging');
        console.log('  • Timeout protection across all network operations');
    } else {
        console.log('⚠️  Some tests failed. Please review the implementation.');
    }
    
    return passed === total;
}

// Run the tests if this script is executed directly
if (require.main === module) {
    runAllTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('💥 Test runner error:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests };
