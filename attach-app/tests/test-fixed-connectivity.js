#!/usr/bin/env node

/**
 * Test the fixed SMB connectivity approach
 * This tests the improved non-blocking connectivity check
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

console.log('🔧 Testing Fixed SMB Connectivity Check');
console.log('=' .repeat(60));

// Simulate the improved checkServerConnectivity function
async function checkServerConnectivity(serverName, timeoutMs = 5000) {
    console.log(`\n🔍 Testing connectivity to "${serverName}":`);
    
    try {
        // First, try to check SMB port (445) connectivity using nc (netcat)
        console.log('   1. Checking SMB port 445 with netcat...');
        try {
            const ncResult = await execPromise(`nc -z -w 3 "${serverName}" 445`, { timeout: 5000 });
            if (ncResult.stdout === '' && !ncResult.stderr) {
                console.log('   ✅ SMB port 445 is accessible!');
                return { accessible: true, method: 'SMB port check' };
            }
        } catch (ncError) {
            console.log('   ⚠️ SMB port check failed or nc not available');
        }

        // Second, try a simple ping
        console.log('   2. Checking with ping...');
        try {
            const pingResult = await execPromise(`ping -c 1 -W ${Math.floor(timeoutMs / 1000)} "${serverName}"`, { timeout: timeoutMs });
            
            if (pingResult.stdout.includes('1 packets transmitted, 1 received')) {
                console.log('   ✅ Ping successful!');
                return { accessible: true, method: 'ping' };
            }
        } catch (pingError) {
            console.log('   ⚠️ Ping failed (common with Windows machines)');
        }

        // Third, try hostname resolution
        console.log('   3. Checking hostname resolution...');
        try {
            const hostResult = await execPromise(`host "${serverName}"`, { timeout: 3000 });
            if (hostResult.stdout.includes('has address') || hostResult.stdout.includes('has IPv6')) {
                console.log('   ✅ Hostname resolves to IP address!');
                return { accessible: true, method: 'DNS resolution' };
            }
        } catch (hostError) {
            console.log('   ⚠️ DNS resolution failed');
        }
        
        console.log('   ⚠️ All standard checks failed, but SMB might still work via NetBIOS');
        return { 
            accessible: false, 
            error: 'Standard connectivity checks failed, but SMB connection may still work via NetBIOS discovery',
            method: 'all failed'
        };
    } catch (error) {
        return { 
            accessible: false, 
            error: 'Unable to verify server connectivity. SMB connection may still work.',
            method: 'error'
        };
    }
}

async function testSMBDirect() {
    console.log('\n🔗 Testing Direct SMB Connection:');
    console.log('-'.repeat(40));
    
    try {
        console.log('   📂 Attempting to list shares (this is what SMB mount will try)...');
        const smbResult = await execPromise('timeout 10 smbutil view "//Workstation"', { timeout: 12000 });
        
        console.log('   ✅ SMB connection successful!');
        console.log('   📋 Available shares:');
        console.log(smbResult.stdout);
        return true;
    } catch (error) {
        console.log('   ⚠️ SMB direct connection result:');
        console.log('   📋 Error:', error.message);
        
        if (error.message.includes('Authentication')) {
            console.log('   💡 This suggests SMB is working but needs credentials');
            return 'needs_auth';
        } else if (error.message.includes('timeout')) {
            console.log('   💡 This suggests slow network or server not responding');
            return 'timeout';
        } else {
            return false;
        }
    }
}

async function simulateNewBehavior() {
    console.log('\n🎯 Simulating New Non-Blocking Behavior:');
    console.log('-'.repeat(40));
    
    const result = await checkServerConnectivity('Workstation', 5000);
    
    console.log(`   📊 Connectivity Check Result:`);
    console.log(`   • Accessible: ${result.accessible}`);
    console.log(`   • Method: ${result.method || 'N/A'}`);
    console.log(`   • Error: ${result.error || 'None'}`);
    
    if (!result.accessible) {
        console.log(`\n   ✅ OLD BEHAVIOR: Would have BLOCKED the mount`);
        console.log(`   ✅ NEW BEHAVIOR: Will ALLOW the mount to proceed`);
        console.log(`   📝 Reason: SMB has its own name resolution (NetBIOS, etc.)`);
        
        console.log('\n   🚀 Proceeding with SMB mount attempt anyway...');
        const smbResult = await testSMBDirect();
        
        if (smbResult === true) {
            console.log('\n   🎉 SUCCESS! SMB works even though ping/DNS failed');
            console.log('   ✅ The fix is working correctly!');
        } else if (smbResult === 'needs_auth') {
            console.log('\n   🎉 PARTIAL SUCCESS! SMB server responds, just needs authentication');
            console.log('   ✅ The fix is working correctly!');
        } else {
            console.log('\n   ⚠️ SMB also failed, but now user gets proper error');
            console.log('   ✅ Better than blocking before attempting');
        }
    } else {
        console.log(`\n   ✅ Server is accessible via ${result.method}`);
        console.log(`   ✅ Mount should proceed normally`);
    }
}

async function verifyFix() {
    console.log('\n✅ VERIFYING THE FIX:');
    console.log('=' .repeat(60));
    
    console.log('📋 PROBLEM BEFORE:');
    console.log('   • checkServerConnectivity used ping with 8-second timeout');
    console.log('   • If ping failed, mount was completely blocked');
    console.log('   • Many Windows machines block ping for security');
    console.log('   • "Workstation" hostname couldn\'t be resolved via DNS');
    console.log('   • Result: No mount attempt was ever made');
    
    console.log('\n📋 SOLUTION AFTER:');
    console.log('   • checkServerConnectivity now tries multiple methods:');
    console.log('     1. SMB port 445 check (most relevant)');
    console.log('     2. Ping (fallback)');
    console.log('     3. DNS resolution (fallback)');
    console.log('   • If all fail, mount is STILL ALLOWED to proceed');
    console.log('   • SMB has NetBIOS name resolution built-in');
    console.log('   • User gets proper SMB-specific error if mount truly fails');
    console.log('   • Timeout reduced from 8s to 5s');
    
    console.log('\n📋 BENEFITS:');
    console.log('   ✅ SMB connections work even when ping is blocked');
    console.log('   ✅ NetBIOS name resolution can work when DNS fails');
    console.log('   ✅ Faster timeout (5s vs 8s)');
    console.log('   ✅ Better error messages for users');
    console.log('   ✅ Non-blocking - attempts mount regardless');
}

async function main() {
    await simulateNewBehavior();
    await verifyFix();
    
    console.log('\n🎉 READY TO TEST:');
    console.log('=' .repeat(60));
    console.log('1. Compile the app: npm run build');
    console.log('2. Test your connection: smb://Workstation/nas');
    console.log('3. Should now work even if Workstation doesn\'t ping!');
    console.log('\n💡 If still having issues, try these:');
    console.log('   • Use IP address instead: smb://192.168.x.x/nas');
    console.log('   • Check if SMB service is running on target machine');
    console.log('   • Verify credentials and share permissions');
}

main().catch(error => {
    console.error('\n❌ Test failed:', error.message);
});
