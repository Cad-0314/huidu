require('dotenv').config();
const silkpayService = require('../services/silkpay');

async function testBalance() {
    console.log('Testing Silkpay Balance Query...');
    try {
        const result = await silkpayService.getBalance();
        console.log('Result:', JSON.stringify(result, null, 2));
        if (result.status === '200' && result.data) {
            console.log('SUCCESS: Connected to Silkpay!');
        } else {
            console.log('FAILED: API returned error.');
        }
    } catch (error) {
        console.error('ERROR:', error.message);
    }
}

testBalance();
