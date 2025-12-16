const axios = require('axios');
const speakeasy = require('speakeasy');

const BASE_URL = 'http://localhost:3000/api';
let adminToken = '';
let merchantToken = '';
let merchantId = '';
let merchantSecret = '';

async function runTest() {
    console.log('--- STARTING 2FA MANAGEMENT TEST ---');

    // 1. Login as Admin
    console.log('1. Logging in as Admin...');
    try {
        const res = await axios.post(`${BASE_URL}/auth/login`, {
            username: 'admin',
            password: 'adminpassword'
        });

        if (res.data.code === 2) {
            console.log('   Admin requires 2FA. Using default...');
            const verify = await axios.post(`${BASE_URL}/auth/verify-2fa`, {
                userId: res.data.userId,
                code: '111111',
                tempToken: res.data.tempToken
            });
            adminToken = verify.data.token;
        } else {
            adminToken = res.data.token;
        }
        console.log('   Admin logged in.');
    } catch (e) {
        console.error('Admin login failed:', e.message);
        process.exit(1);
    }

    // 2. Create Test Merchant
    console.log('2. Creating Test Merchant...');
    try {
        const username = `test_mgmt_${Date.now()}`;
        const res = await axios.post(`${BASE_URL}/admin/users`, {
            username: username,
            password: 'password123',
            name: 'Test Merchant Mgmt',
            callbackUrl: 'http://localhost:3000/callback',
            payinRate: 5.0,
            payoutRate: 3.0
        }, { headers: { Authorization: `Bearer ${adminToken}` } });

        merchantId = res.data.data.id;
        console.log('   Merchant created:', merchantId);
    } catch (e) {
        console.error('Create merchant failed:', e.message);
        process.exit(1);
    }

    // 3. Login as Merchant & Enable 2FA
    console.log('3. Log in as Merchant & Enable 2FA...');
    try {
        // Login
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            username: `test_mgmt_${merchantId.split('-')[1]}`, // Reconstruct username or fetch? Wait, I didn't save username.
            // Ah, I created it with `test_mgmt_${Date.now()}`. I need that variable.
            // Let's just trust the flow or use the recent one.
        });
        // Actually, easier to just use the one I just made.
        // Wait, I need the username.
        // Let's simpler: Just use a known username pattern or creating a user returns it? 
        // The previous code `username` variable holds it.
        // Issue: `username` is local to the block? No, I'll fix scope.
    } catch (e) {
        // Simplify: Just use the returned data if possible or fix test structure.
    }
}

// Rewriting test to be cleaner
async function test() {
    try {
        // Admin Login
        const adminLogin = await axios.post(`${BASE_URL}/auth/login`, { username: 'admin', password: 'admin123' });
        console.log('Admin Login Response:', adminLogin.data);
        let aToken = adminLogin.data.token;
        if (adminLogin.data.code === 2) {
            console.log('Admin requires 2FA...');
            const v = await axios.post(`${BASE_URL}/auth/verify-2fa`, { userId: adminLogin.data.userId, code: '111111', tempToken: adminLogin.data.tempToken });
            console.log('Admin Verify Response:', v.data);
            aToken = v.data.data.token;
        }
        console.log('Using Admin Token:', aToken);

        // Create Merchant
        const mUsername = `user_${Date.now()}`;
        const createRes = await axios.post(`${BASE_URL}/admin/users`, {
            username: mUsername, password: 'password', name: 'User 2FA Test', callbackUrl: 'x', payinRate: 5, payoutRate: 3
        }, { headers: { Authorization: `Bearer ${aToken}` } });
        const mId = createRes.data.data.id;
        console.log(`Created Merchant: ${mUsername} (${mId})`);

        // Merchant Login
        const mLogin = await axios.post(`${BASE_URL}/auth/login`, { username: mUsername, password: 'password' });
        let mToken = mLogin.data.token;
        // Verify (Default)
        if (mLogin.data.code === 2) {
            const mv = await axios.post(`${BASE_URL}/auth/verify-2fa`, { userId: mLogin.data.userId, code: '111111', tempToken: mLogin.data.tempToken });
            mToken = mv.data.data.token;
        }

        // Setup 2FA
        const setup = await axios.post(`${BASE_URL}/auth/2fa/setup`, {}, { headers: { Authorization: `Bearer ${mToken}` } });
        const secret = setup.data.data.secret;
        const code = speakeasy.totp({ secret: secret, encoding: 'base32' });
        await axios.post(`${BASE_URL}/auth/2fa/enable`, { code }, { headers: { Authorization: `Bearer ${mToken}` } });
        console.log('Merchant enabled 2FA.');

        // Verify Enabled
        const mLogin2 = await axios.post(`${BASE_URL}/auth/login`, { username: mUsername, password: 'password' });
        if (mLogin2.data.code !== 2) throw new Error('Expected 2FA prompt');
        console.log('Merchant prompted for 2FA as expected.');

        // TEST 1: Merchant Disable 2FA
        console.log('Testing Merchant Disable 2FA...');
        // We need a valid token to call disable. We can assume the session is active from `mToken`?
        // Wait, enabling 2FA might require re-login or the token is still valid. 
        // Usually token is valid.
        await axios.post(`${BASE_URL}/auth/2fa/disable`, {}, { headers: { Authorization: `Bearer ${mToken}` } });
        console.log('Merchant disabled 2FA.');

        // Verify Disabled
        const mLogin3 = await axios.post(`${BASE_URL}/auth/login`, { username: mUsername, password: 'password' });
        // Should prompt for 2FA but accept default 111111 because enabled=0?
        // Code logic: if !enabled, verify=111111. The prompt code=2 always happens? 
        // Let's check auth.js. 
        // Yes, login always returns code:2. But if enabled=0, code=111111 works.
        const mv3 = await axios.post(`${BASE_URL}/auth/verify-2fa`, { userId: mLogin3.data.userId, code: '111111', tempToken: mLogin3.data.tempToken });
        if (mv3.data.code !== 1) throw new Error('Expected login with default code after disable');
        console.log('Merchant verified disabled 2FA (Default code worked).');

        // Note: For Test 2 (Admin Reset), we need to Enable again.
        // Doing that quickly.
        const setup2 = await axios.post(`${BASE_URL}/auth/2fa/setup`, {}, { headers: { Authorization: `Bearer ${mv3.data.data.token}` } });
        const secret2 = setup2.data.data.secret;
        const code2 = speakeasy.totp({ secret: secret2, encoding: 'base32' });
        await axios.post(`${BASE_URL}/auth/2fa/enable`, { code: code2 }, { headers: { Authorization: `Bearer ${mv3.data.data.token}` } });
        console.log('Merchant re-enabled 2FA.');

        // TEST 2: Admin Reset 2FA
        console.log('Testing Admin Reset 2FA...');
        await axios.post(`${BASE_URL}/admin/users/${mId}/2fa/reset`, {}, { headers: { Authorization: `Bearer ${aToken}` } });
        console.log('Admin reset merchant 2FA.');

        // Verify Disabled
        const mLogin4 = await axios.post(`${BASE_URL}/auth/login`, { username: mUsername, password: 'password' });
        const mv4 = await axios.post(`${BASE_URL}/auth/verify-2fa`, { userId: mLogin4.data.userId, code: '111111', tempToken: mLogin4.data.tempToken });
        if (mv4.data.code !== 1) throw new Error('Expected login with default code after admin reset');
        console.log('Merchant verified disabled 2FA (Default code worked).');

        console.log('--- TEST PASSED ---');

    } catch (e) {
        console.error('TEST FAILED:', e.message, e.response?.data);
        process.exit(1);
    }
}

test();
