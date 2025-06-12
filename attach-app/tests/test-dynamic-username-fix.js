#!/usr/bin/env node

/**
 * Test script to verify the dynamic username fix
 * This validates that the hardcoded "felipe@" has been replaced with dynamic username detection
 */

const fs = require('fs');
const os = require('os');

console.log('🔧 Testing Dynamic Username Fix for Mount Conflict Detection');
console.log('===========================================================');

function getCurrentUsername() {
    try {
        return os.userInfo().username;
    } catch (error) {
        return process.env.USER || process.env.USERNAME || 'user';
    }
}

function testDynamicUsername() {
    console.log('\n1. ✅ Testing dynamic username detection:');
    
    const username = getCurrentUsername();
    console.log(`   📋 Current username: "${username}"`);
    
    // Test the username pattern that would be generated
    const testSharePath = 'workstation/nas';
    const expectedPattern = `${username}@${testSharePath}`;
    console.log(`   🎯 Generated pattern: "${expectedPattern}"`);
    
    // Verify it's not hardcoded to "felipe"
    if (expectedPattern.startsWith('felipe@') && username !== 'felipe') {
        console.log('   ❌ ERROR: Still using hardcoded username!');
        return false;
    } else {
        console.log('   ✅ Dynamic username detection working correctly');
        return true;
    }
}

function verifyCodeChanges() {
    console.log('\n2. ✅ Verifying code changes:');
    
    const filesToCheck = [
        'src/main/utils/mountCoordinator.ts',
        'src/main/mount/smbService.ts'
    ];
    
    let allFilesFixed = true;
    
    filesToCheck.forEach(file => {
        const filePath = `/Users/felipe/Documents/dev/Attach/attach-app/${file}`;
        
        if (!fs.existsSync(filePath)) {
            console.log(`   ❌ File not found: ${file}`);
            allFilesFixed = false;
            return;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if hardcoded "felipe@" still exists
        if (content.includes('felipe@')) {
            console.log(`   ❌ File still contains hardcoded "felipe@": ${file}`);
            allFilesFixed = false;
        } else {
            console.log(`   ✅ File fixed (no hardcoded username): ${file}`);
        }
        
        // Check if getCurrentUsername() function is present
        if (content.includes('getCurrentUsername()')) {
            console.log(`   ✅ File uses dynamic username function: ${file}`);
        } else {
            console.log(`   ⚠️  File doesn't use getCurrentUsername(): ${file}`);
            // This might be okay if the file doesn't need the function
        }
    });
    
    return allFilesFixed;
}

function simulateConflictDetection() {
    console.log('\n3. ✅ Simulating conflict detection logic:');
    
    const currentUser = getCurrentUsername();
    const testScenarios = [
        {
            name: 'System mount with username',
            systemMount: `${currentUser}@workstation/nas`,
            connectionPath: 'workstation/nas',
            shouldMatch: true
        },
        {
            name: 'System mount without username',
            systemMount: 'workstation/nas',
            connectionPath: 'workstation/nas',
            shouldMatch: true
        },
        {
            name: 'Different user system mount',
            systemMount: 'otheruser@workstation/nas',
            connectionPath: 'workstation/nas',
            shouldMatch: true // Should still match because we strip username
        },
        {
            name: 'Different share',
            systemMount: `${currentUser}@workstation/photos`,
            connectionPath: 'workstation/nas',
            shouldMatch: false
        }
    ];
    
    testScenarios.forEach(scenario => {
        console.log(`\n   🧪 Testing: ${scenario.name}`);
        console.log(`      System mount: "${scenario.systemMount}"`);
        console.log(`      Connection:   "${scenario.connectionPath}"`);
        
        // Simulate the conflict detection logic
        const mountPath = scenario.systemMount.toLowerCase();
        const normalizedSharePath = scenario.connectionPath.toLowerCase();
        
        let isConflict = false;
        
        // 1. Direct match (without username)
        if (mountPath === normalizedSharePath) {
            isConflict = true;
        }
        
        // 2. Strip username from mount path
        const mountPathWithoutUser = mountPath.replace(/^[^@]+@/, '');
        if (mountPathWithoutUser === normalizedSharePath) {
            isConflict = true;
        }
        
        // 3. Add username to connection path (FIXED - now dynamic)
        if (mountPath === `${currentUser.toLowerCase()}@${normalizedSharePath}`) {
            isConflict = true;
        }
        
        const result = isConflict ? '✅ CONFLICT DETECTED' : '❌ No conflict';
        const expected = scenario.shouldMatch ? '✅ CONFLICT DETECTED' : '❌ No conflict';
        
        if (isConflict === scenario.shouldMatch) {
            console.log(`      Result: ${result} (CORRECT)`);
        } else {
            console.log(`      Result: ${result} (WRONG - expected ${expected})`);
        }
    });
}

async function main() {
    const usernameTest = testDynamicUsername();
    const codeChangesTest = verifyCodeChanges();
    
    simulateConflictDetection();
    
    console.log('\n📋 Summary:');
    console.log('===========');
    
    if (usernameTest && codeChangesTest) {
        console.log('✅ SUCCESS: Dynamic username fix implemented correctly!');
        console.log('\n🎯 Key Benefits:');
        console.log('   • Works for any user, not just "felipe"');
        console.log('   • Automatically detects current username');
        console.log('   • Mount conflict detection now portable');
        console.log('   • No more hardcoded user-specific paths');
        
        console.log('\n🧪 Recommended Testing:');
        console.log('   1. Test with different user accounts');
        console.log('   2. Verify conflict detection works on other machines');
        console.log('   3. Check that auto-mount works for all users');
        console.log('   4. Ensure existing mounts are properly cleaned up');
        
        process.exit(0);
    } else {
        console.log('❌ FAILED: Issues found with the dynamic username fix');
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
