const axios = require('axios');
const crypto = require('crypto');

// Details from DB Lookup for Order 251222CaqAcOyKSzxlbxW3oZf6
const callbackUrl = 'https://m2api.g77.game/scr/payvspay2back';
const merchantKey = 'MK_8759C8DA5E414FA6837AFC3F'; // From DB for user JUGAME (User ID 30)

const payload = {
    // Standard fields usually expected by merchant
    "member_id": "30", // or "JUGAME" or however they id themselves. Let's send what we usually send.
    // Actually, let's keep it simple to what they might expect based on standard Payin Callback
    "order_no": "J1766396713753", // Merchant Order ID
    "amount": "100",
    "transaction_id": "251222CaqAcOyKSzxlbxW3oZf6", // Platform ID
    "status": "success",

    // Also including fields they might have sent just in case
    "orderAmount": 100,
    "orderId": "J1766396713753"
};

// Generate Signature (Sorted Params)
function generateSign(params, secret) {
    const filteredParams = {};
    for (const key of Object.keys(params)) {
        if (key !== 'sign' && params[key] !== null && params[key] !== undefined && params[key] !== '') {
            filteredParams[key] = params[key];
        }
    }
    const sortedKeys = Object.keys(filteredParams).sort();
    const queryParts = sortedKeys.map(key => `${key}=${filteredParams[key]}`);
    const signString = `${queryParts.join('&')}&secret=${secret}`;
    return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
}

payload.sign = generateSign(payload, merchantKey);

console.log('Sending Callback to:', callbackUrl);
console.log('Payload:', JSON.stringify(payload, null, 2));

axios.post(callbackUrl, payload)
    .then(res => {
        console.log('✅ Callback Sent Successfully');
        console.log('Response Status:', res.status);
        console.log('Response Data:', res.data);
    })
    .catch(err => {
        console.error('❌ Callback Failed');
        if (err.response) {
            console.log('Status:', err.response.status);
            console.log('Data:', err.response.data);
        } else {
            console.log('Error:', err.message);
        }
    });
