const app = require('../server'); // Import app (this might init DB if not careful, but we'll handle it)
const axios = require('axios');
const http = require('http');
const { getDb, initDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const PORT = 3005; // Use a different port
let server;
let testMerchantId;

async function setup() {
    console.log('Setup: Initializing DB...');
    await initDatabase();

    // Start Server
    server = http.createServer(app);
    return new Promise((resolve) => {
        server.listen(PORT, async () => {
            console.log(`Test server running on port ${PORT}`);

            // Create Test Merchant
            const db = getDb();
            const merchantKey = 'test_key_' + uuidv4();
            const uuid = uuidv4();
            testMerchantId = uuid;

            try {
                // Ensure unique
                db.prepare('DELETE FROM users WHERE email = ?').run('test_api@example.com');

                const result = db.prepare(`INSERT INTO users (uuid, email, password, role, merchant_key, balance, status, two_factor_enabled, two_factor_secret, username, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(uuid, 'test_api@example.com', 'hash', 'user', merchantKey, 1000.00, 'active', 1, 'ORSXG5A=', 'test_user', 'Test Name');

                console.log('Test merchant created:', uuid);
                resolve({ merchantKey, uuid });
            } catch (e) {
                console.error('Setup failed:', e);
                resolve(null);
            }
        });
    });
}

function generateSign(body, key) {
    const bodyStr = Object.keys(body).length > 0 ? JSON.stringify(body) : '{}';
    return crypto.createHash('md5').update(bodyStr + key).digest('hex');
}

async function runTest() {
    const creds = await setup();
    if (!creds) {
        process.exit(1);
    }

    try {
        const payload = {
            amount: 100,
            orderId: 'TEST_' + Date.now(),
            account: '1234567890',
            ifsc: 'SBIN0001234',
            personName: 'Test User'
            // No CODE provided
        };

        const sign = generateSign(payload, creds.merchantKey);

        console.log('Sending request without 2FA code...');
        try {
            const res = await axios.post(`http://localhost:${PORT}/api/payout/bank`, payload, {
                headers: {
                    'x-merchant-id': creds.uuid,
                    'x-signature': sign
                }
            });
            console.log('Response:', res.data);
            if (res.data.code === 1 || res.data.msg.includes('Insufficient balance') || res.data.msg.includes('Payout submitted')) {
                console.log('SUCCESS: API request processed without 2FA code.');
            } else {
                console.log('UNEXPECTED SUCCESS RESPONSE:', res.data);
            }
        } catch (error) {
            if (error.response) {
                console.log('Error Response:', error.response.data);
                if (error.response.data.msg && error.response.data.msg.includes('2FA code is required')) {
                    console.error('FAILURE: 2FA code was still required!');
                    process.exit(1);
                } else if (error.response.data.msg && error.response.data.msg.includes('Invalid 2FA code')) {
                    console.error('FAILURE: 2FA code was checked and found invalid!');
                    process.exit(1);
                } else {
                    // Other errors (e.g. balance) are fine, as long as it passed 2FA
                    console.log('SUCCESS: Validation passed (failed on something else):', error.response.data.msg);
                }
            } else {
                console.error('Request Error:', error.message);
            }
        }

    } finally {
        // Cleanup
        const db = getDb();
        if (testMerchantId) {
            db.prepare('DELETE FROM users WHERE uuid = ?').run(testMerchantId);
        }
        server.close();
        process.exit(0);
    }
}

runTest();
