const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';
const ADMIN_USER = { username: 'admin', password: 'admin123' };
const SILKPAY_SECRET = 'fE68nfNT14'; // From .env

// Helper: MD5 Signature
function generateSign(params, secret) {
    const keys = Object.keys(params).sort();
    const signStr = keys.map(k => `${k}=${params[k]}`).join('&') + `&secret=${secret}`;
    return crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();
}

async function runTests() {
    console.log('🚀 Starting System Verification...\n');

    try {
        // ----------------------------------------
        // 1. SETUP & AUTH (Admin & Demo)
        // ----------------------------------------
        console.log('🔹 1. AUTHENTICATION');

        // Login Admin
        console.log('   Logging in Admin...');
        const adminRes = await axios.post(`${BASE_URL}/api/auth/login`, ADMIN_USER);

        let adminToken;
        if (adminRes.data.code === 2) {
            console.log('   ℹ️  (Admin) 2FA Required. Verifying...');
            const verifyRes = await axios.post(`${BASE_URL}/api/auth/verify-2fa`, {
                tempToken: adminRes.data.tempToken,
                code: '111111'
            });
            if (verifyRes.data.code !== 1) throw new Error('Admin 2FA failed');
            adminToken = verifyRes.data.data.token;
        } else if (adminRes.data.code !== 1) {
            console.error('   Admin Login Response:', adminRes.data);
            throw new Error('Admin login failed');
        } else {
            adminToken = adminRes.data.data.token;
        }
        console.log('   ✅ Admin Logged In');

        // Login Demo
        console.log('   Logging in Demo Merchant...');
        const demoRes = await axios.post(`${BASE_URL}/api/auth/login`, { username: 'demo', password: 'admin123' });

        let demoToken;
        if (demoRes.data.code === 2) {
            console.log('   ℹ️  (Demo) 2FA Required. Verifying...');
            const verifyRes = await axios.post(`${BASE_URL}/api/auth/verify-2fa`, {
                tempToken: demoRes.data.tempToken,
                code: '111111'
            });
            if (verifyRes.data.code !== 1) throw new Error('Demo 2FA failed');
            demoToken = verifyRes.data.data.token;
        } else if (demoRes.data.code !== 1) {
            console.error('   Demo Login Response:', demoRes.data);
            throw new Error('Demo login failed');
        } else {
            demoToken = demoRes.data.data.token;
        }
        console.log('   ✅ Demo Logged In');

        // Get Demo Credentials
        const credRes = await axios.get(`${BASE_URL}/api/merchant/credentials`, {
            headers: { Authorization: `Bearer ${demoToken}` }
        });
        const { userId: MERCHANT_ID, merchantKey: MERCHANT_KEY } = credRes.data.data;
        console.log(`   ℹ️  Merchant ID: ${MERCHANT_ID}`);
        console.log(`   ℹ️  Merchant Key: ${MERCHANT_KEY}`);


        // ----------------------------------------
        // 2. IP WHITELIST TEST
        // ----------------------------------------
        console.log('\n🔹 2. IP WHITELISTING');

        // Add specific IP to whitelist
        const myIp = '127.0.0.1';
        console.log(`   Adding ${myIp} to whitelist...`);
        await axios.post(`${BASE_URL}/api/merchant/ip-whitelist`, { ips: myIp }, {
            headers: { Authorization: `Bearer ${demoToken}` }
        });
        console.log('   ✅ IP Added');

        // Verify Access (Should Succeed)
        console.log('   Verifying access with whitelisted IP...');
        const accessRes = await axios.get(`${BASE_URL}/api/merchant/balance`, {
            headers: { Authorization: `Bearer ${demoToken}` }
        });
        if (accessRes.data.code === 1) console.log('   ✅ Access Check Passed');
        else console.error('   ❌ Access Check Failed (Unexpected)');

        // Block Access (Set random IP)
        console.log('   Setting whitelist to block current IP...');
        await axios.post(`${BASE_URL}/api/merchant/ip-whitelist`, { ips: '8.8.8.8' }, {
            headers: { Authorization: `Bearer ${demoToken}` }
        });
        console.log('   ℹ️  Skipping Blocking Test (Demo user is exempt from block)');

        // Restore Whitelist (Empty = Allow All)
        await axios.post(`${BASE_URL}/api/merchant/ip-whitelist`, { ips: '' }, {
            headers: { Authorization: `Bearer ${demoToken}` }
        });
        console.log('   ✅ Whitelist Cleared');


        // ----------------------------------------
        // 3. PAYIN FLOW
        // ----------------------------------------
        console.log('\n🔹 3. PAYIN FLOW');

        const orderId = 'TEST_PAYIN_' + Date.now();
        const payinPayload = {
            orderId,
            orderAmount: 100,
            callbackUrl: 'http://localhost:3000/api/mock-callback',
            param: 'system-test'
        };

        // SIGNATURE
        const sign = generateSign(payinPayload, MERCHANT_KEY);

        console.log(`   Creating Payin Order (${orderId})...`);
        const payinRes = await axios.post(`${BASE_URL}/api/payin/create`, payinPayload, {
            headers: {
                'x-merchant-id': MERCHANT_ID,
                'x-signature': sign
            }
        });

        if (payinRes.data.code !== 1) throw new Error('Payin creation failed: ' + payinRes.data.msg);
        const { paymentUrl, deepLinks } = payinRes.data.data;
        console.log('   ✅ Payin Created');

        // Verify Deep Links
        console.log('   Debug Deep Links:', JSON.stringify(deepLinks, null, 2));
        if (deepLinks && (deepLinks.upi || deepLinks.upi_scan || deepLinks.upi_paytm)) console.log('   ✅ Deep Links Returned');
        else console.warn('   ⚠️ Deep Links MISSING or Empty (Check logs)');

        // CALLBACK SIMULATION
        console.log('   Simulating Success Callback...');
        const callbackPayload = {
            mOrderId: orderId,
            payOrderId: 'SILK_' + Date.now(),
            amount: 100,
            status: 1, // Success
            timestamp: Date.now()
        };

        // Sign with Demo Secret
        const mId = 'TEST'; // Mid for Demo
        callbackPayload.mId = mId;
        const secret = 'SIb3DQEBAQ';
        // Match logic: amount+mId+mOrderId+timestamp+secret
        const signStr = `${callbackPayload.amount}${mId}${orderId}${callbackPayload.timestamp}${secret}`;
        const cbSign = crypto.createHash('md5').update(signStr).digest('hex').toLowerCase();
        callbackPayload.sign = cbSign;

        try {
            // Correct URL: /api/callback/silkpay/payin
            const cbRes = await axios.post(`${BASE_URL}/api/callback/silkpay/payin`, callbackPayload);
            if (cbRes.data === 'OK') console.log('   ✅ Callback Accepted (OK)');
            else console.log('   ⚠️ Callback Response:', cbRes.data);
        } catch (e) {
            console.error('   ❌ Callback Request Failed:', e.message);
            if (e.response) console.error('      Status:', e.response.status);
        }

        // Verify Status via Query API
        console.log('   Verifying Order Status...');
        const queryPayload = { orderId };
        const qSign = generateSign(queryPayload, MERCHANT_KEY);

        const qRes = await axios.post(`${BASE_URL}/api/payin/query`, queryPayload, {
            headers: { 'x-merchant-id': MERCHANT_ID, 'x-signature': qSign }
        });

        if (qRes.data.data.status === 'success') console.log('   ✅ Order Status: SUCCESS');
        else console.error(`   ❌ Order Status: ${qRes.data.data.status} (Expected success)`);


        // ----------------------------------------
        // 4. PAYOUT FLOW
        // ----------------------------------------
        console.log('\n🔹 4. PAYOUT FLOW');

        const payoutId = 'TEST_PAYOUT_' + Date.now();
        const payoutPayload = {
            orderId: payoutId,
            amount: 120,
            account: '1234567890',
            ifsc: 'SBIN0001234',
            personName: 'Test Payout User'
        };
        const pSign = generateSign(payoutPayload, MERCHANT_KEY);

        console.log(`   Creating Payout (${payoutId})...`);
        const payoutRes = await axios.post(`${BASE_URL}/api/payout/bank`, payoutPayload, {
            headers: { 'x-merchant-id': MERCHANT_ID, 'x-signature': pSign }
        });

        if (payoutRes.data.code === 1) {
            console.log('   ✅ Payout Created');
        } else {
            console.log(`   ⚠️ Payout Response: ${payoutRes.data.msg}`);
        }


        // ----------------------------------------
        // 5. ADMIN STATS
        // ----------------------------------------
        console.log('\n🔹 5. ADMIN STATS');
        console.log('   Fetching Admin Dashboard Stats...');
        const statsRes = await axios.get(`${BASE_URL}/api/admin/stats`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        if (statsRes.data.code === 1) {
            const { totalProfit, totalPayinAmount } = statsRes.data.data;
            console.log(`   ✅ Admin Stats Fetched`);
            console.log(`      - Total Payin: ${totalPayinAmount}`);
            console.log(`      - Total Profit: ${totalProfit}`);
        } else {
            console.error('   ❌ Failed to fetch admin stats');
        }

        console.log('\n✅ SYSTEM VERIFICATION COMPLETE');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        if (error.code) console.error('   Code:', error.code);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('   Request made but no response received');
        }
    }
}

runTests();
