const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');

// Configuration
const BASE_URL = process.env.SILKPAY_BASE_URL || 'https://api.dev.silkpay.ai';
const MID = process.env.SILKPAY_MID || 'TEST';
const SECRET = process.env.SILKPAY_SECRET || 'SIb3DQEBAQ';

const ERROR_LOG_FILE = path.join(__dirname, '..', 'error.txt');
const REQUEST_LOG_FILE = path.join(__dirname, '..', 'api_requests.log');

// Helper to log errors
function logApiError(endpoint, error, requestData) {
    const timestamp = new Date().toISOString();
    const errorMessage = error.message || String(error);
    const responseData = error.response ? JSON.stringify(error.response.data) : errorMessage;

    console.error(`[${timestamp}] SILKPAY API ERROR [${endpoint}]:`, errorMessage);

    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO api_logs (endpoint, request, response, duration, status)
            VALUES (?, ?, ?, 0, 'error')
        `).run(endpoint, JSON.stringify(requestData), responseData);
    } catch (e) {
        console.error('Failed to log API error to DB:', e);
    }
}

// Helper to log requests
function logApiRequest(endpoint, requestData, response, duration) {
    const timestamp = new Date().toISOString();
    const safeRequest = { ...requestData }; // Redact if needed

    console.log(`[${timestamp}] SILKPAY API: ${endpoint} (${duration}ms)`);
    // console.log('Request:', JSON.stringify(safeRequest));
    // console.log('Response:', JSON.stringify(response));

    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO api_logs (endpoint, request, response, duration, status)
            VALUES (?, ?, ?, ?, 'success')
        `).run(endpoint, JSON.stringify(safeRequest), JSON.stringify(response), duration);
    } catch (e) {
        console.error('Failed to log API request to DB:', e);
    }
}

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Signature Generation Helper
function createSign(str) {
    return crypto.createHash('md5').update(str).digest('hex').toLowerCase(); // 32-bit lowercase
}

/**
 * 1. Create Payin Order (v2)
 * Endpoint: /transaction/payin/v2
 * Sign: md5(mId+mOrderId+amount+timestamp+secret)
 */
async function createPayin(data, config = {}) {
    const { orderAmount, orderId, notifyUrl, returnUrl } = data;
    const timestamp = Date.now().toString();

    const mid = config.mid || MID;
    const secret = config.secret || SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    // Sign uses the overridden secret and mid
    const signStr = `${mid}${orderId}${orderAmount}${timestamp}${secret}`;
    const sign = createSign(signStr);

    const params = {
        amount: orderAmount,
        mId: mid,
        mOrderId: orderId,
        timestamp,
        notifyUrl,
        returnUrl,
        sign
    };

    const startTime = Date.now();
    try {
        const response = await axios.post(`${baseUrl}/transaction/payin/v2`, params, { timeout: 30000 });
        logApiRequest('createPayin', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('createPayin', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * 2. Payin Order Status Query
 * Endpoint: /transaction/payin/query
 * Sign: md5(mId+mOrderId+timestamp+key)  (Assuming key=SECRET)
 */
async function queryPayin(orderId) {
    const timestamp = Date.now().toString();
    const signStr = `${MID}${orderId}${timestamp}${SECRET}`;
    const sign = createSign(signStr);

    const params = {
        mId: MID,
        mOrderId: orderId,
        timestamp,
        sign
    };

    const startTime = Date.now();
    try {
        const response = await api.post('/transaction/payin/query', params);
        logApiRequest('queryPayin', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('queryPayin', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * 1. Create Payout Order
 * Endpoint: /transaction/payout
 * Sign: md5(mId+mOrderId+amount+timestamp+secret)
 */
async function createPayout(data, config = {}) {
    const { amount, orderId, notifyUrl, bankNo, ifsc, name } = data;
    const timestamp = Date.now().toString();

    const mid = config.mid || MID;
    const secret = config.secret || SECRET;
    const baseUrl = config.baseUrl || BASE_URL;

    // Sign uses overridden credentials
    const signStr = `${mid}${orderId}${amount}${timestamp}${secret}`;
    const sign = createSign(signStr);

    const params = {
        amount,
        mId: mid,
        mOrderId: orderId,
        timestamp,
        notifyUrl,
        bankNo,
        ifsc,
        name,
        sign,
        upi: "" // Optional but included as empty in docs
    };

    const startTime = Date.now();
    try {
        const response = await axios.post(`${baseUrl}/transaction/payout`, params, { timeout: 30000 });
        logApiRequest('createPayout', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('createPayout', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * 2. Payout Order Status Inquiry
 * Endpoint: /transaction/payout/query
 * Sign: md5(mId+mOrderId+timestamp+secret)
 */
async function queryPayout(orderId) {
    const timestamp = Date.now().toString();
    const signStr = `${MID}${orderId}${timestamp}${SECRET}`;
    const sign = createSign(signStr);

    const params = {
        mId: MID,
        mOrderId: orderId,
        timestamp,
        sign
    };

    const startTime = Date.now();
    try {
        const response = await api.post('/transaction/payout/query', params);
        logApiRequest('queryPayout', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('queryPayout', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * 4. Submit UTR & Order ID for Compensation
 * Endpoint: /transaction/payin/submit/utr
 * Sign: md5(mId+timestamp+secret) (Note: Docs say mId+timestamp+secret, but usually includes params. Docs are authority: mId+timestamp+secret)
 */
async function submitUtr(orderId, utr) {
    const timestamp = Date.now().toString();
    const signStr = `${MID}${timestamp}${SECRET}`;
    const sign = createSign(signStr);

    const params = {
        mId: MID,
        utr,
        mOrderId: orderId,
        sign,
        timestamp
    };

    const startTime = Date.now();
    try {
        const response = await api.post('/transaction/payin/submit/utr', params);
        logApiRequest('submitUtr', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('submitUtr', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * 5. UTR Query Order
 * Endpoint: /transaction/payin/query/utr
 * Sign: md5(mId+timestamp+secret)
 */
async function queryUtr(utr) {
    const timestamp = Date.now().toString();
    const signStr = `${MID}${timestamp}${SECRET}`;
    const sign = createSign(signStr);

    const params = {
        mId: MID,
        utr,
        sign,
        timestamp
    };

    const startTime = Date.now();
    try {
        const response = await api.post('/transaction/payin/query/utr', params);
        logApiRequest('queryUtr', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('queryUtr', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * Merchant Balance Inquiry
 * Endpoint: /transaction/balance
 * Sign: md5(mId+timestamp+secret)
 */
async function getBalance() {
    const timestamp = Date.now().toString();
    const signStr = `${MID}${timestamp}${SECRET}`;
    const sign = createSign(signStr);

    const params = {
        mId: MID,
        timestamp,
        sign
    };

    const startTime = Date.now();
    try {
        const response = await api.post('/transaction/balance', params);
        logApiRequest('getBalance', params, response.data, Date.now() - startTime);
        return response.data;
    } catch (error) {
        logApiError('getBalance', error, params);
        return { status: "500", message: error.message };
    }
}

/**
 * Verify Callback Signature
 * Payin Callback Sign: md5(amount+mId+mOrderId+timestamp+secret)
 * Payout Callback Sign: md5(mId+mOrderId+amount+timestamp+secret) or (mId+mOrderId+amount+timestamp+secret) ?
 * 
 * Payin Docs: sign = md5(amount+mId+mOrderId+timestamp+secret)
 * Payout Docs: sign = md5(mId+mOrderId+amount+timestamp+secret)
 */
function verifyPayinCallback(data, secretOverride = null) {
    const { amount, mId, mOrderId, timestamp, sign } = data;
    const secret = secretOverride || SECRET;
    const str = `${amount}${mId}${mOrderId}${timestamp}${secret}`;
    const calculated = createSign(str);
    return calculated === sign;
}

function verifyPayoutCallback(data, secretOverride = null) {
    const { mId, mOrderId, amount, timestamp, sign } = data;
    const secret = secretOverride || SECRET;
    const str = `${mId}${mOrderId}${amount}${timestamp}${secret}`;
    const calculated = createSign(str);
    return calculated === sign;
}

// Helper for self-callbacks (Demo Mode)
function generatePayinCallbackBody(orderId, amount, config = {}) {
    const mid = config.mid || MID;
    const secret = config.secret || SECRET;
    const timestamp = Date.now().toString();
    const payOrderId = 'DEMO_' + Date.now();

    // Sign: md5(amount+mId+mOrderId+timestamp+secret)
    const signStr = `${amount}${mid}${orderId}${timestamp}${secret}`;
    const sign = createSign(signStr);

    return {
        status: '1',
        amount: amount.toString(),
        payOrderId,
        mId: mid,
        mOrderId: orderId,
        timestamp,
        sign,
        utr: 'TEST_UTR_' + Date.now()
    };
}

function generatePayoutCallbackBody(orderId, amount, config = {}) {
    const mid = config.mid || MID;
    const secret = config.secret || SECRET;
    const timestamp = Date.now().toString();

    // Sign: md5(mId+mOrderId+amount+timestamp+secret)
    const signStr = `${mid}${orderId}${amount}${timestamp}${secret}`;
    const sign = createSign(signStr);

    return {
        status: '1',
        amount: amount.toString(),
        mId: mid,
        mOrderId: orderId,
        timestamp,
        sign,
        utr: 'TEST_UTR_' + Date.now()
    };
}

module.exports = {
    createPayin,
    queryPayin,
    createPayout,
    queryPayout,
    submitUtr,
    queryUtr,
    getBalance,
    verifyPayinCallback,
    verifyPayoutCallback,
    generatePayinCallbackBody,
    generatePayoutCallbackBody
};
