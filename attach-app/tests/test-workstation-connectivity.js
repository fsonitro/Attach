#!/usr/bin/env node

/**
 * Debug script to test connectivity to the user's specific share: smb://Workstation/nas
 * This will help identify why the mount is failing after our network checks implementation
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

console.log('🔍 Testing Connectivity to smb://Workstation/nas');
console.log('=' .repeat(60));

async function testServerConnectivity() {
    console.log('\n1. Testing Ping Connectivity to "Workstation":');
    console.log('-'.repeat(40));
    
    try {
        console.log('   📡 Attempting ping...');
        const pingResult = await execPromise('ping -c 1 -W 8 "Workstation"', { timeout: 10000 });
        
        if (pingResult.stdout.includes('1 packets transmitted, 1 received')) {
            console.log('   ✅ Ping successful!');
            console.log('   🔗 Workstation responds to ping');
            return true;
        } else {
            console.log('   ⚠️ Ping failed - no response received');
            console.log('   📋 Output:', pingResult.stdout.trim());
            return false;
        }
    } catch (error) {
        console.log('   ❌ Ping failed with error');
        console.log('   📋 Error:', error.message);
        
        // Check if it's a timeout vs hostname resolution issue
        if (error.message.includes('cannot resolve')) {
            console.log('   🚨 ISSUE: Hostname "Workstation" cannot be resolved');
            console.log('   💡 Suggestion: Use IP address instead of hostname');
        } else if (error.message.includes('timeout') || error.message.includes('no route')) {
            console.log('   🚨 ISSUE: Network timeout or unreachable');
        } else {
            console.log('   🚨 ISSUE: Ping blocked (common in secure networks)');
        }
        
        return false;
    }
}

async function testHostResolution() {
    console.log('\n2. Testing DNS/Host Resolution for "Workstation":');
    console.log('-'.repeat(40));
    
    try {
        console.log('   🔍 Attempting host lookup...');
        const hostResult = await execPromise('host "Workstation"', { timeout: 5000 });
        
        if (hostResult.stdout.includes('has address') || hostResult.stdout.includes('has IPv6')) {
            console.log('   ✅ Host resolution successful!');
            console.log('   📋 Result:', hostResult.stdout.trim());
            return true;
        } else {
            console.log('   ⚠️ Host resolution unclear');
            console.log('   📋 Output:', hostResult.stdout.trim());
            return false;
        }
    } catch (error) {
        console.log('   ❌ Host resolution failed');
        console.log('   📋 Error:', error.message);
        return false;
    }
}

async function testSMBListShares() {
    console.log('\n3. Testing SMB Share Listing (without auth):');
    console.log('-'.repeat(40));
    
    try {
        console.log('   📂 Attempting to list shares on Workstation...');
        const smbResult = await execPromise('smbutil view "//Workstation"', { timeout: 10000 });
        
        console.log('   ✅ SMB connection successful!');
        console.log('   📋 Available shares:');
        console.log(smbResult.stdout);
        return true;
    } catch (error) {
        console.log('   ❌ SMB listing failed');
        console.log('   📋 Error:', error.message);
        
        if (error.message.includes('authentication')) {
            console.log('   💡 Suggestion: Shares may require authentication');
        } else if (error.message.includes('connection')) {
            console.log('   💡 Suggestion: SMB service may not be running or accessible');
        }
        
        return false;
    }
}

async function testNetBeui() {
    console.log('\n4. Testing NetBIOS Name Resolution:');
    console.log('-'.repeat(40));
    
    try {
        console.log('   🔍 Checking NetBIOS names...');
        const nbResult = await execPromise('nbtscan Workstation 2>/dev/null || echo "nbtscan not available"', { timeout: 5000 });
        
        if (nbResult.stdout.includes('not available')) {
            console.log('   ℹ️  nbtscan tool not available (this is normal)');
        } else {
            console.log('   📋 NetBIOS scan result:', nbResult.stdout.trim());
        }
    } catch (error) {
        console.log('   ℹ️  NetBIOS scanning not available or failed');
    }
}

async function testAlternativeApproaches() {
    console.log('\n5. Testing Alternative Connection Methods:');
    console.log('-'.repeat(40));
    
    // Test with IP instead of hostname
    console.log('   🔍 Testing IP address approach...');
    try {
        // Try to get IP from hostname
        const getentResult = await execPromise('getent hosts Workstation', { timeout: 3000 });
        const ipMatch = getentResult.stdout.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
        
        if (ipMatch) {
            const ip = ipMatch[1];
            console.log(`   ✅ Found IP address: ${ip}`);
            console.log(`   💡 Try using: smb://${ip}/nas instead of smb://Workstation/nas`);
            
            // Test ping to IP
            try {
                const ipPingResult = await execPromise(`ping -c 1 -W 3 "${ip}"`, { timeout: 5000 });
                if (ipPingResult.stdout.includes('1 packets transmitted, 1 received')) {
                    console.log(`   ✅ IP ${ip} responds to ping!`);
                } else {
                    console.log(`   ⚠️ IP ${ip} doesn't respond to ping (but SMB might still work)`);
                }
            } catch (ipPingError) {
                console.log(`   ⚠️ IP ${ip} doesn't respond to ping (but SMB might still work)`);
            }
        }
    } catch (error) {
        console.log('   ⚠️ Could not resolve hostname to IP');
    }
    
    // Test without ping
    console.log('\n   🔍 Testing direct SMB mount without ping check...');
    console.log('   ⚠️  This is what the app should do when ping fails');
}

async function analyzeIssue() {
    console.log('\n6. Issue Analysis & Recommendations:');
    console.log('-'.repeat(40));
    
    console.log('   🔍 PROBLEM ANALYSIS:');
    console.log('   • Our new connectivity check uses ping before mounting');
    console.log('   • Many Windows machines block ICMP ping for security');
    console.log('   • This prevents legitimate SMB connections from working');
    console.log('   • Hostname "Workstation" suggests Windows machine/workgroup');
    
    console.log('\n   💡 SOLUTIONS:');
    console.log('   1. Make ping check non-blocking (allow mount even if ping fails)');
    console.log('   2. Use SMB port check (445) instead of ping');
    console.log('   3. Add fallback to direct mount attempt');
    console.log('   4. Make connectivity check optional/configurable');
    
    console.log('\n   🚨 IMMEDIATE FIXES NEEDED:');
    console.log('   • Modify checkServerConnectivity to be less aggressive');
    console.log('   • Allow SMB mount to proceed even when ping fails');
    console.log('   • Add proper SMB port connectivity test');
    console.log('   • Only block mount for severe network issues');
}

async function runFullTest() {
    const results = {
        ping: false,
        hostResolution: false,
        smbList: false,
        canConnect: false
    };
    
    results.ping = await testServerConnectivity();
    results.hostResolution = await testHostResolution();
    results.smbList = await testSMBListShares();
    
    await testNetBeui();
    await testAlternativeApproaches();
    await analyzeIssue();
    
    console.log('\n7. TEST RESULTS SUMMARY:');
    console.log('=' .repeat(60));
    console.log(`   Ping Test:           ${results.ping ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Host Resolution:     ${results.hostResolution ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   SMB Share Listing:   ${results.smbList ? '✅ PASS' : '❌ FAIL'}`);
    
    if (results.smbList) {
        console.log('\n   🎉 SMB connection works - the issue is our ping check!');
        console.log('   🔧 Need to fix connectivity check to allow SMB when ping fails');
    } else if (results.hostResolution) {
        console.log('\n   ⚠️  Host resolves but SMB connection fails');
        console.log('   🔧 May need authentication or SMB service issue');
    } else {
        console.log('\n   🚨 Fundamental network/hostname issue');
        console.log('   🔧 Check network configuration and hostname');
    }
    
    return results;
}

// Run the test
runFullTest().catch(error => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
});
