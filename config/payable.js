require('dotenv').config();

module.exports = {
    baseUrl: process.env.PAYABLE_BASE_URL || 'https://payable8.com/api',
    secret: process.env.PAYABLE_SECRET,
    userId: process.env.PAYABLE_USER_ID,

    // Exchange rates
    usdtRate: parseFloat(process.env.USDT_RATE) || 103, // 1 USDT = 103 INR

    // Endpoints
    endpoints: {
        balance: '/payable/balance/query',
        payout: '/payable/payment',
        payoutQuery: '/payable/payment/query',
        payin: '/payable/recharge',
        payinQuery: '/payable/recharge/query',
        utrOrder: '/payable/utr/order',
        utrQuery: '/payable/utr/query',
        upi: '/payable/upi'
    }
};
