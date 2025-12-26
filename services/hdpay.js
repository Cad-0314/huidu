/**
 * HDPay Service (Channel 4)
 * MD5 signature authentication for India Payin/Payout
 * Base URL: https://dd1688.cc
 */

const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');

// Configuration from environment
const BASE_URL = process.env.HDPAY_BASE_URL || 'https://dd1688.cc';
const MERCHANT_ID = process.env.HDPAY_MERCHANT_ID;
const SECRET_KEY = process.env.HDPAY_SECRET_KEY;

const ERROR_LOG_FILE = path.join(__dirname, '..', 'hdpay_error.txt');
const REQUEST_LOG_FILE = path.join(__dirname, '..', 'hdpay_requests.log');

// Helper to log errors
function logError(endpoint, error, requestData) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] HDPAY ERROR ${endpoint}\nRequest: ${JSON.stringify(requestData)}\nError: ${error.message || JSON.stringify(error)}`;
    console.error('[HDPAY ERROR]', entry);
    try {
        fs.appendFileSync(ERROR_LOG_FILE, entry + '\n\n');
    } catch (e) { }
    logToDatabase(endpoint, requestData, { error: error.message || error }, 0, 'error');
}

// Helper to log requests
function logRequest(endpoint, requestData, response, duration) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] HDPAY ${endpoint} (${duration}ms)\nRequest: ${JSON.stringify(requestData, null, 2)}\nResponse: ${JSON.stringify(response, null, 2)}`;
    console.log('[HDPAY REQUEST]', entry);
    try {
        fs.appendFileSync(REQUEST_LOG_FILE, entry + '\n\n');
    } catch (e) { }
    logToDatabase(endpoint, requestData, response, duration, 'success');
}

// Helper to log to database
async function logToDatabase(endpoint, request, response, duration, status) {
    try {
        const db = getDb();
        await db.prepare(`
            INSERT INTO api_logs (endpoint, request, response, duration, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            'HDPAY:' + endpoint,
            JSON.stringify(request),
            JSON.stringify(response),
            duration,
            status
        );
    } catch (e) {
        console.error('[HDPAY] Failed to log to database:', e.message);
    }
}

// Axios instance
const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

/**
 * Generate MD5 Signature
 * 1. Sort parameters by ASCII key ascending
 * 2. Concatenate as key=value&key=value...
 * 3. Append &key=SECRET_KEY
 * 4. MD5 and lowercase
 */
function createSign(params, secretOverride = null) {
    const secret = secretOverride || SECRET_KEY;
    const filteredParams = {};

    for (const key of Object.keys(params)) {
        if (key !== 'sign' && params[key] !== null && params[key] !== undefined && params[key] !== '') {
            filteredParams[key] = params[key];
        }
    }

    const sortedKeys = Object.keys(filteredParams).sort();
    const queryParts = sortedKeys.map(key => `${key}=${filteredParams[key]}`);
    const queryString = queryParts.join('&');
    const signString = `${queryString}&key=${secret}`;

    return crypto.createHash('md5').update(signString).digest('hex').toLowerCase();
}

/**
 * Verify callback signature
 */
function verifySign(params, secretOverride = null) {
    const receivedSign = params.sign;
    if (!receivedSign) return false;

    const calculatedSign = createSign(params, secretOverride);
    return receivedSign.toLowerCase() === calculatedSign;
}

/**
 * Create Payin Order
 * POST /api/payin/submit
 */
async function createPayin(data, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        merchantOrderId: data.orderId,
        amount: parseFloat(data.amount).toFixed(2),
        notifyUrl: data.notifyUrl,
        name: data.customerName || 'Customer',
        mobile: data.customerPhone || '9999999999',
        email: data.customerEmail || 'customer@example.com',
        deeplink: true
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payin/submit', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payin/submit', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            // HDPay: Always use payUrl directly, ignore deeplinks
            // Users will be redirected to HDPay's payment page
            return {
                code: 1,
                status: '200',
                data: {
                    paymentUrl: resData.data?.payUrl,
                    payOrderId: resData.data?.orderId
                    // No deepLink - HDPay uses their own payment page
                },
                message: resData.msg
            };
        } else {
            return {
                code: 0,
                status: resData.code?.toString() || '500',
                message: resData.msg || 'Failed to create order'
            };
        }
    } catch (e) {
        logError('/api/payin/submit', e, params);
        return { code: 0, status: '500', message: e.message };
    }
}

/**
 * Query Payin Order Status
 * POST /api/payin/status
 */
async function queryPayin(orderId, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        merchantOrderId: orderId
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payin/status', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payin/status', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            // Map status: 0=pending, 1=success, 2=failed
            let status = 'pending';
            if (resData.data?.status === '1') status = 'success';
            else if (resData.data?.status === '2') status = 'failed';

            return {
                code: 1,
                status: '200',
                data: {
                    orderId: resData.data?.merchantOrderId,
                    platformOrderId: resData.data?.orderId,
                    status: status,
                    message: resData.data?.message
                }
            };
        } else {
            return { code: 0, status: resData.code?.toString(), message: resData.msg };
        }
    } catch (e) {
        logError('/api/payin/status', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Submit UTR for Order (Order Replacement/Fix)
 * POST /api/payin/utr/fix
 */
async function submitUtr(orderId, utr, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        merchantOrderId: orderId,
        utr: utr
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payin/utr/fix', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payin/utr/fix', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            return { code: 1, status: '200', message: resData.msg || 'UTR submitted' };
        } else {
            return { code: 0, message: resData.msg || 'UTR submission failed' };
        }
    } catch (e) {
        logError('/api/payin/utr/fix', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Query UTR Status
 * POST /api/payin/utr/check
 */
async function queryUtr(utr, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        utr: utr
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payin/utr/check', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payin/utr/check', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            return {
                code: 1,
                status: '200',
                data: {
                    utr: resData.data?.utr,
                    amount: resData.data?.amount,
                    status: resData.data?.status,
                    matchOrderId: resData.data?.matchOrderId
                }
            };
        } else {
            return { code: 0, message: resData.msg };
        }
    } catch (e) {
        logError('/api/payin/utr/check', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Create Payout Order
 * POST /api/payout/submit
 */
async function createPayout(data, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        merchantPayoutId: data.orderId,
        amount: parseFloat(data.amount).toFixed(2),
        notifyUrl: data.notifyUrl,
        name: data.name,
        type: '0', // 0 = Bank Card, 1 = UPI
        account: data.bankNo,
        ifsc: data.ifsc
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payout/submit', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payout/submit', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            return {
                code: 1,
                payOrderId: resData.data?.payoutId,
                message: resData.msg || 'Payout submitted',
                data: resData.data
            };
        } else {
            return { code: 0, message: resData.msg || 'Payout failed' };
        }
    } catch (e) {
        logError('/api/payout/submit', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Query Payout Order Status
 * POST /api/payout/query
 */
async function queryPayout(orderId, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId,
        merchantPayoutId: orderId
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payout/query', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payout/query', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            let status = 'processing';
            if (resData.data?.status === '1') status = 'success';
            else if (resData.data?.status === '2') status = 'failed';

            return {
                code: 1,
                status: '200',
                data: {
                    orderId: resData.data?.merchantPayoutId,
                    platformOrderId: resData.data?.payoutId,
                    status: status,
                    amount: resData.data?.amount,
                    utr: resData.data?.utr,
                    message: resData.data?.msg
                }
            };
        } else {
            return { code: 0, message: resData.msg };
        }
    } catch (e) {
        logError('/api/payout/query', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Get Payout Balance
 * POST /api/payout/balance
 */
async function getBalance(config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const secret = config.secret || SECRET_KEY;

    if (!merchantId || !secret) {
        return { code: 0, msg: 'HDPAY credentials not configured' };
    }

    const params = {
        merchantId: merchantId
    };

    params.sign = createSign(params, secret);

    try {
        const response = await api.post('/api/payout/balance', params);
        const duration = Date.now() - startTime;
        logRequest('/api/payout/balance', params, response.data, duration);

        const resData = response.data;
        if (resData.code === 200) {
            return {
                code: 1,
                status: '200',
                data: {
                    balance: resData.data || 0
                }
            };
        } else {
            return { code: 0, message: resData.msg };
        }
    } catch (e) {
        logError('/api/payout/balance', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Verify Payin Callback Signature
 */
function verifyPayinCallback(data, secretOverride = null) {
    return verifySign(data, secretOverride);
}

/**
 * Verify Payout Callback Signature
 */
function verifyPayoutCallback(data, secretOverride = null) {
    return verifySign(data, secretOverride);
}

module.exports = {
    createPayin,
    queryPayin,
    submitUtr,
    queryUtr,
    createPayout,
    queryPayout,
    getBalance,
    verifyPayinCallback,
    verifyPayoutCallback,
    createSign,
    verifySign
};
