/**
 * Yellow Service (Channel 5 - BombayPay)
 * MD5-based signature authentication
 * 
 * Gateway: https://server.bombaypay.cloud
 * 
 * Endpoints:
 *   - Payin: POST /api/v1/collection_order_create
 *   - Payout: POST /api/v1/payment_order_create
 *   - Query Payin: POST /api/v1/collection_order_query
 *   - Query Payout: POST /api/v1/payment_order_query
 *   - Balance: POST /api/v1/query_account_balance
 */

const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');

// Configuration
const BASE_URL = process.env.YELLOW_BASE_URL || 'https://server.bombaypay.cloud';
const APP_KEY = process.env.YELLOW_APP_KEY;
const APP_SECRET = process.env.YELLOW_APP_SECRET;

const ERROR_LOG_FILE = path.join(__dirname, '..', 'yellow_error.txt');
const REQUEST_LOG_FILE = path.join(__dirname, '..', 'yellow_requests.log');

// Helper to log errors
function logError(endpoint, error, requestData) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] YELLOW ERROR ${endpoint}\nRequest: ${JSON.stringify(requestData)}\nError: ${error.message || JSON.stringify(error)}`;
    console.error('[YELLOW ERROR]', entry);
    try {
        fs.appendFileSync(ERROR_LOG_FILE, entry + '\n\n');
    } catch (e) { }

    logToDatabase(endpoint, requestData, { error: error.message || error }, 0, 'error');
}

// Helper to log requests
function logRequest(endpoint, requestData, response, duration) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] YELLOW ${endpoint} (${duration}ms)\nRequest: ${JSON.stringify(requestData, null, 2)}\nResponse: ${JSON.stringify(response, null, 2)}`;
    console.log('[YELLOW REQUEST]', entry);
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
            'YELLOW:' + endpoint,
            JSON.stringify(request),
            JSON.stringify(response),
            duration,
            status
        );
    } catch (e) {
        console.error('[YELLOW] Failed to log to database:', e.message);
    }
}

// Axios instance
const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'multipart/form-data'
    },
    family: 4 // Force IPv4
});

/**
 * Create MD5 Signature
 * 
 * 1. Sort all parameters by key in ascending order (exclude empty strings and 'sign')
 * 2. Concatenate as key=value&key=value...&app_secret=xxx
 * 3. MD5 hash the result (lowercase)
 */
function createSign(params, appSecret) {
    // Filter out empty strings and sign field
    const filteredParams = {};
    for (const key of Object.keys(params)) {
        if (key !== 'sign' && params[key] !== '' && params[key] !== null && params[key] !== undefined) {
            filteredParams[key] = params[key];
        }
    }

    // Sort by key ascending
    const sortedKeys = Object.keys(filteredParams).sort();

    // Build query string
    const parts = sortedKeys.map(key => `${key}=${filteredParams[key]}`);
    parts.push(`app_secret=${appSecret}`);

    const signStr = parts.join('&');
    console.log('[YELLOW] Sign string:', signStr);

    const sign = crypto.createHash('md5').update(signStr).digest('hex').toLowerCase();
    console.log('[YELLOW] Generated sign:', sign);

    return sign;
}

/**
 * Verify callback signature
 */
function verifySign(params, appSecret) {
    const receivedSign = params.sign;
    const calculatedSign = createSign(params, appSecret);
    return receivedSign === calculatedSign;
}

/**
 * Create Payin Order
 * POST /api/v1/collection_order_create
 */
async function createPayin(data, config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    console.log('[YELLOW] ========== PAYIN REQUEST ==========');
    console.log('[YELLOW] Input Data:', JSON.stringify(data, null, 2));
    console.log('[YELLOW] Config:', {
        baseUrl,
        appKey: appKey ? 'SET' : 'NOT SET'
    });

    if (!appKey || !appSecret) {
        logError('createPayin', { error: 'YELLOW_APP_KEY or YELLOW_APP_SECRET not set' }, data);
        return { code: 0, message: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString(),
        order_out_no: data.orderId,
        order_amount: Math.round(data.amount).toString(),
        callback_url: data.notifyUrl
    };

    // Generate signature
    params.sign = createSign(params, appSecret);

    try {
        // Send as form-data
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/collection_order_create`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/collection_order_create', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            // Extract deeplinks from response
            const deepLink = {
                upi: resData.data?.upi || '',
                phonepe: resData.data?.phonepe || '',
                gpay: resData.data?.gpay || '',
                paytm: resData.data?.paytm || '',
                upi_scan: resData.data?.upi || ''
            };

            return {
                code: 1,
                status: '200',
                message: resData.message,
                data: {
                    payOrderId: resData.data?.order_no,
                    paymentUrl: resData.data?.pay_url,
                    orderToken: resData.data?.order_no_token,
                    deepLink: deepLink
                }
            };
        } else {
            return {
                code: 0,
                message: resData.message || 'Failed to create payin order'
            };
        }

    } catch (e) {
        logError('/api/v1/collection_order_create', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Create Payout Order
 * POST /api/v1/payment_order_create
 */
async function createPayout(data, config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    console.log('[YELLOW] ========== PAYOUT REQUEST ==========');
    console.log('[YELLOW] Input Data:', JSON.stringify(data, null, 2));

    if (!appKey || !appSecret) {
        logError('createPayout', { error: 'YELLOW_APP_KEY or YELLOW_APP_SECRET not set' }, data);
        return { code: 0, message: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString(),
        order_out_no: data.orderId,
        order_amount: Math.round(data.amount).toString(),
        bank_code: data.ifsc,
        bank_account: data.bankNo,
        bank_user_name: data.name,
        callback_url: data.notifyUrl
    };

    params.sign = createSign(params, appSecret);

    try {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/payment_order_create`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/payment_order_create', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            return {
                code: 1,
                payOrderId: resData.data?.order_no,
                message: resData.message
            };
        } else {
            return {
                code: 0,
                message: resData.message || 'Failed to create payout order'
            };
        }

    } catch (e) {
        logError('/api/v1/payment_order_create', e, params);
        return { code: 0, message: e.message };
    }
}

/**
 * Query Payin Order
 * POST /api/v1/collection_order_query
 */
async function queryPayin(orderId, config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    if (!appKey || !appSecret) {
        return { code: 0, msg: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString(),
        order_out_no: orderId
    };

    params.sign = createSign(params, appSecret);

    try {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/collection_order_query`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/collection_order_query', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            // Map status: 10=pending, 20=success, others=failed (inferred)
            let status = 'pending';
            if (resData.data?.order_status === 20) status = 'success';
            else if (resData.data?.order_status > 20) status = 'failed';

            return {
                code: 1,
                data: {
                    orderId: resData.data?.order_out_no,
                    status: status,
                    amount: resData.data?.order_amount,
                    utr: resData.data?.utr || ''
                }
            };
        } else {
            return { code: 0, msg: resData.message || 'Query failed' };
        }

    } catch (e) {
        logError('/api/v1/collection_order_query', e, { orderId });
        return { code: 0, msg: e.message };
    }
}

/**
 * Query Payout Order
 * POST /api/v1/payment_order_query
 */
async function queryPayout(orderId, config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    if (!appKey || !appSecret) {
        return { code: 0, msg: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString(),
        order_out_no: orderId
    };

    params.sign = createSign(params, appSecret);

    try {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/payment_order_query`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/payment_order_query', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            // Map status: 20=success, others based on doc
            let status = 'processing';
            if (resData.data?.order_status === 20) status = 'success';
            else if (resData.data?.order_status > 20) status = 'failed';

            return {
                code: 1,
                data: {
                    orderId: resData.data?.order_out_no,
                    status: status,
                    amount: resData.data?.order_amount,
                    utr: resData.data?.utr || '',
                    message: resData.data?.fail_msg || ''
                }
            };
        } else {
            return { code: 0, msg: resData.message || 'Query failed' };
        }

    } catch (e) {
        logError('/api/v1/payment_order_query', e, { orderId });
        return { code: 0, msg: e.message };
    }
}

/**
 * Get Balance
 * POST /api/v1/query_account_balance
 */
async function getBalance(config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    if (!appKey || !appSecret) {
        return { code: 0, msg: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString()
    };

    params.sign = createSign(params, appSecret);

    try {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/query_account_balance`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/query_account_balance', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            return {
                code: 1,
                data: {
                    incomeBalance: parseFloat(resData.data?.income_balance) || 0,
                    payBalance: parseFloat(resData.data?.pay_balance) || 0,
                    frozenBalance: parseFloat(resData.data?.frozen_balance) || 0,
                    incomeRate: resData.data?.income_rate,
                    payRate: resData.data?.pay_rate
                }
            };
        } else {
            return { code: 0, msg: resData.message || 'Balance query failed' };
        }

    } catch (e) {
        logError('/api/v1/query_account_balance', e, {});
        return { code: 0, msg: e.message };
    }
}

/**
 * Verify Payin Callback Signature
 */
function verifyPayinCallback(callbackData, appSecretOverride = null) {
    const appSecret = appSecretOverride || APP_SECRET;
    return verifySign(callbackData, appSecret);
}

/**
 * Verify Payout Callback Signature
 */
function verifyPayoutCallback(callbackData, appSecretOverride = null) {
    const appSecret = appSecretOverride || APP_SECRET;
    return verifySign(callbackData, appSecret);
}

/**
 * Submit UTR for Order Verification
 * POST /api/v1/collection_order_verification
 */
async function submitUtr(orderId, utr, config = {}) {
    const startTime = Date.now();
    const appKey = config.appKey || APP_KEY;
    const appSecret = config.appSecret || APP_SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    if (!appKey || !appSecret) {
        return { code: 0, msg: 'Yellow configuration missing' };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
        app_key: appKey,
        sign_ver: '1.0',
        timestamp: timestamp.toString(),
        order_out_no: orderId,
        utr: utr
    };

    params.sign = createSign(params, appSecret);

    try {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, value);
        }

        const response = await axios.post(`${baseUrl}/api/v1/collection_order_verification`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });

        const duration = Date.now() - startTime;
        logRequest('/api/v1/collection_order_verification', params, response.data, duration);

        const resData = response.data;

        if (resData.success && resData.code === 200) {
            return { code: 1, message: 'UTR submitted successfully' };
        } else {
            return { code: 0, msg: resData.message || 'UTR verification failed' };
        }

    } catch (e) {
        logError('/api/v1/collection_order_verification', e, { orderId, utr });
        return { code: 0, msg: e.message };
    }
}

module.exports = {
    createPayin,
    createPayout,
    queryPayin,
    queryPayout,
    getBalance,
    submitUtr,
    verifyPayinCallback,
    verifyPayoutCallback,
    createSign,
    verifySign
};
