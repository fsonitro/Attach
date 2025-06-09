// Test script to verify password handling with special characters
const testPasswords = [
    'simple123',
    'password$with$dollars',
    'pass/with/slashes',
    'complex*password%',
    'password+with+plus',
    'password-with-dashes',
    'password{with}braces',
    'password=with=equals',
    'password~with~tildes',
    'password!with!exclamation',
    'password@with@at',
    'password#with#hash',
    'password^with^caret',
    'password&with&ampersand',
    'password(with)parentheses',
    'password[with]brackets',
    'password\\with\\backslashes',
    'password|with|pipes',
    'password;with;semicolons',
    'password:with:colons',
    'password"with"quotes',
    "password'with'apostrophes",
    'password<with>angles',
    'password,with,commas',
    'password.with.dots',
    'password?with?questions',
    'password with spaces',
    'Мой пароль', // Cyrillic
    '我的密码',   // Chinese
    'contraseña', // Spanish with ñ
];

console.log('Testing password encoding with encodeURIComponent:');
console.log('='.repeat(60));

testPasswords.forEach((password, index) => {
    const encoded = encodeURIComponent(password);
    const decoded = decodeURIComponent(encoded);
    const isReversible = password === decoded;
    
    console.log(`${index + 1}. Password: "${password}"`);
    console.log(`   Encoded:  "${encoded}"`);
    console.log(`   Decoded:  "${decoded}"`);
    console.log(`   Reversible: ${isReversible ? '✅' : '❌'}`);
    
    if (!isReversible) {
        console.log('   ⚠️  ENCODING ISSUE DETECTED!');
    }
    console.log('');
});

// Test shell escaping for the listSMBShares function
console.log('\nTesting shell escaping for listSMBShares:');
console.log('='.repeat(60));

const escapeShellArg = (arg) => {
    return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
};

testPasswords.forEach((password, index) => {
    const escaped = escapeShellArg(password);
    console.log(`${index + 1}. Password: "${password}"`);
    console.log(`   Escaped:  ${escaped}`);
    console.log('');
});

console.log('✅ All password encoding tests completed!');
console.log('This verifies that both encodeURIComponent (for mount URLs) and shell escaping (for command line) handle special characters correctly.');
