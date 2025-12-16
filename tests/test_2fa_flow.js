const axios = require('axios');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');

const ADMIN_API = 'http://localhost:3000/api/admin';
const AUTH_API = 'http://localhost:3000/api/auth';
const PAYOUT_API = 'http://localhost:3000/api/payout';

// Test User Credentials
const TEST_USER = {
    username: 'test_merchant_' + Date.now(),
    password: 'password123',
    name: 'Tezt Merchant'
};

let userToken = null;
let twoFaSecret = null;
let userId = null;

async function runTest() {
    try {
        console.log('--- STARTING 2FA FLOW TEST ---');

        // 1. Create User (via Admin - assume admin exists or we can just register if there was a register endpoint, but logic says admin creates)
        // We need admin token first? Or just insert into DB directly? 
        // Let's use the DB directly for setup to avoid admin login complexity if possible, OR login as admin.
        // I will assume admin/admin123 works from server.js default.

        console.log('1. Logging in as Admin...');
        const adminLogin = await axios.post(AUTH_API + '/login', { username: 'admin', password: 'admin123' });
        let adminToken;
        if (adminLogin.data.code === 2) {
            console.log('   Admin requires 2FA (Default code 111111)...');
            const verifyAdmin = await axios.post(AUTH_API + '/verify-2fa', { tempToken: adminLogin.data.tempToken, code: '111111' });
            adminToken = verifyAdmin.data.data.token;
        } else {
            adminToken = adminLogin.data.data.token;
        }
        console.log('   Admin logged in.');

        console.log('2. Creating Test Merchant...');
        await axios.post(ADMIN_API + '/users', {
            username: TEST_USER.username,
            password: TEST_USER.password,
            name: TEST_USER.name,
            payinRate: 5.0,
            payoutRate: 3.0
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        console.log('   Merchant created.');

        // 3. Login as Merchant (First Time - Expect 2FA Requirement with Default Code)
        console.log('3. Log in as Merchant (Fresh)...');
        const login1 = await axios.post(AUTH_API + '/login', { username: TEST_USER.username, password: TEST_USER.password });

        if (login1.data.code === 2 && login1.data.require2fa) {
            console.log('   Got 2FA prompt as expected.');
            const tempToken = login1.data.tempToken;

            // Verify with default code 111111
            console.log('4. Verifying with default code 111111...');
            const verify1 = await axios.post(AUTH_API + '/verify-2fa', { tempToken, code: '111111' });

            if (verify1.data.code === 1) {
                userToken = verify1.data.data.token;
                console.log('   Login successful with default code.');
            } else {
                throw new Error('Failed to verify default code');
            }
        } else {
            throw new Error('Did not get 2FA prompt for fresh user');
        }

        // 4. Setup 2FA
        console.log('5. Setting up 2FA...');
        const setup = await axios.post(AUTH_API + '/2fa/setup', {}, { headers: { Authorization: `Bearer ${userToken}` } });
        twoFaSecret = setup.data.data.secret;
        console.log('   Got Secret:', twoFaSecret);

        // 5. Enable 2FA
        console.log('6. Enabling 2FA...');
        const token1 = speakeasy.totp({ secret: twoFaSecret, encoding: 'base32' });
        await axios.post(AUTH_API + '/2fa/enable', { code: token1 }, { headers: { Authorization: `Bearer ${userToken}` } });
        console.log('   2FA Enabled.');

        // 6. Re-Login (Expect 2FA Requirement with REAL Code)
        console.log('7. Re-Logging in...');
        const login2 = await axios.post(AUTH_API + '/login', { username: TEST_USER.username, password: TEST_USER.password });

        if (login2.data.code === 2 && login2.data.require2fa) {
            const tempToken = login2.data.tempToken;

            // Try default code (Should FAIL)
            try {
                await axios.post(AUTH_API + '/verify-2fa', { tempToken, code: '111111' });
                console.error('   ERROR: Default code worked after enabling 2FA!');
            } catch (e) {
                console.log('   Default code rejected as expected.');
            }

            // Try valid TOTP
            const token2 = speakeasy.totp({ secret: twoFaSecret, encoding: 'base32' });
            const verify2 = await axios.post(AUTH_API + '/verify-2fa', { tempToken, code: token2 });
            if (verify2.data.code === 1) {
                userToken = verify2.data.data.token; // New token
                userId = verify2.data.data.user.id;
                console.log('   Login successful with TOTP.');
            } else {
                throw new Error('Failed to verify TOTP');
            }
        }

        // 7. Attempt Payout with 2FA
        console.log('8. Attempting Payout (Bank)...');
        // Need balance first? Merchant starts with 0. 
        // Admin add balance? or just fail on balance check but pass 2FA check?
        // Let's add balance to be clean.
        // Let's add balance to be clean.
        await axios.post(ADMIN_API + `/users/${userId}/balance`, { amount: 1000, reason: 'test credit' }, { headers: { Authorization: `Bearer ${adminToken}` } });

        const token3 = speakeasy.totp({ secret: twoFaSecret, encoding: 'base32' });
        try {
            await axios.post(PAYOUT_API + '/bank', {
                userId: userId,
                amount: 100,
                orderId: 'TEST_' + Date.now(),
                account: '1234567890',
                ifsc: 'TEST0000001',
                personName: 'Test Payout',
                code: token3
            }, { headers: { Authorization: `Bearer ${userToken}` } });
            console.log('   Payout request accepted (2FA valid).');
        } catch (e) {
            if (e.response && e.response.data && e.response.data.msg.includes('Silkpay')) {
                console.log('   Payout passed 2FA (failed at upstream as expected).');
            } else {
                console.error('   Payout failed:', e.response ? e.response.data : e.message);
                throw e;
            }
        }

        console.log('--- TEST COMPLETED SUCCESSFULLY ---');

    } catch (error) {
        console.error('TEST FAILED:', error.response ? error.response.data : error.message);
        process.exit(1);
    }
}

runTest();
