/**
 * F2PAY Service (Channel 2)
 * RSA-based signature authentication for India Payin/Payout
 */

const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Configuration from environment
const BASE_URL = process.env.F2PAY_BASE_URL || 'https://api.dev.f2pay.com';
const MERCHANT_ID = process.env.F2PAY_MERCHANT_ID || 'F2PAY_TEST';
const PLATFORM_PUBLIC_KEY = process.env.F2PAY_PLATFORM_PUBLIC_KEY || '';
const MERCHANT_PRIVATE_KEY = process.env.F2PAY_MERCHANT_PRIVATE_KEY || '';

const ERROR_LOG_FILE = path.join(__dirname, '..', 'f2pay_error.txt');
const REQUEST_LOG_FILE = path.join(__dirname, '..', 'f2pay_requests.log');

// Helper to log errors
function logError(endpoint, error, requestData) {
    const entry = `[${new Date().toISOString()}] ${endpoint}\nRequest: ${JSON.stringify(requestData)}\nError: ${error.message || error}\n\n`;
    try {
        fs.appendFileSync(ERROR_LOG_FILE, entry);
    } catch (e) { }
}

// Helper to log requests
function logRequest(endpoint, requestData, response, duration) {
    const entry = `[${new Date().toISOString()}] ${endpoint} (${duration}ms)\nRequest: ${JSON.stringify(requestData)}\nResponse: ${JSON.stringify(response)}\n\n`;
    try {
        fs.appendFileSync(REQUEST_LOG_FILE, entry);
    } catch (e) { }
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
 * Create RSA Signature using SHA256WithRSA
 * Signs the bizContent JSON string with the merchant private key
 */
/**
 * Helper to format key with PEM headers and 64-char line breaks
 */
function formatPem(keyStr, type) {
    if (!keyStr) return '';
    // If already has headers, return as is (simple check)
    if (keyStr.includes('-----BEGIN')) return keyStr;

    const header = `-----BEGIN ${type} KEY-----`;
    const footer = `-----END ${type} KEY-----`;

    // Remove any existing spaces/newlines just in case
    const cleanKey = keyStr.replace(/[\r\n\s]/g, '');

    // Split into 64 char chunks
    const chunks = cleanKey.match(/.{1,64}/g);
    const body = chunks ? chunks.join('\n') : cleanKey;

    return `${header}\n${body}\n${footer}`;
}

/**
 * Create RSA Signature using SHA256WithRSA
 * Signs the bizContent JSON string with the merchant private key
 */
function createRsaSign(data, privateKeyOverride = null) {
    try {
        const rawKey = privateKeyOverride || MERCHANT_PRIVATE_KEY;
        const formattedKey = formatPem(rawKey, 'PRIVATE');

        const sign = crypto.createSign('SHA256');
        sign.update(data, 'utf8');
        sign.end();

        return sign.sign(formattedKey, 'base64');
    } catch (error) {
        console.error('RSA Sign Error:', error);
        throw error;
    }
}

/**
 * Verify RSA Signature using SHA256WithRSA
 * Verifies the response/callback signature with platform public key
 */
function verifyRsaSign(data, signature, publicKeyOverride = null) {
    try {
        const rawKey = publicKeyOverride || PLATFORM_PUBLIC_KEY;
        const formattedKey = formatPem(rawKey, 'PUBLIC');

        const verify = crypto.createVerify('SHA256');
        verify.update(data, 'utf8');
        verify.end();

        return verify.verify(formattedKey, signature, 'base64');
    } catch (error) {
        console.error('RSA Verify Error:', error);
        return false;
    }
}

/**
 * Generate unique trace ID
 */
function generateTraceId(prefix = 'IN') {
    const timestamp = Date.now();
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}${timestamp}${rand}`;
}

/**
 * Create Payin Order V2
 * Endpoint: POST /payin/inr/order/createV2
 * Returns payment URL and account info including UPI deep links
 */
async function createPayinV2(data, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const privateKey = config.privateKey || MERCHANT_PRIVATE_KEY;

    const traceId = data.orderId || generateTraceId('IN');

    // Build bizContent object
    const bizContent = {
        amount: parseFloat(data.amount).toFixed(2),
        customerEmail: data.customerEmail || 'customer@example.com',
        customerIpAddress: data.customerIp || '127.0.0.1',
        customerName: data.customerName || 'Customer',
        customerPhone: data.customerPhone || '9999999999',
        mchOrderNo: data.orderId,
        methodCode: 'UpiMixed', // Fixed for INR payin
        notifyUrl: data.notifyUrl,
        returnUrl: data.returnUrl || data.notifyUrl
    };

    // Optional fields
    if (data.body) bizContent.body = data.body;
    if (data.subject) bizContent.subject = data.subject;

    const bizContentStr = JSON.stringify(bizContent);

    // Create signature
    const sign = createRsaSign(bizContentStr, privateKey);

    const requestBody = {
        traceId: traceId,
        merchantId: merchantId,
        bizContent: bizContentStr,
        signType: 'RSA',
        sign: sign
    };

    console.log(`[F2PAY] Creating Payin V2 Order: ${data.orderId}`);

    try {
        const response = await api.post('/payin/inr/order/createV2', requestBody);
        const duration = Date.now() - startTime;

        logRequest('/payin/inr/order/createV2', requestBody, response.data, duration);

        const resData = response.data;

        if (resData.code === '0000') {
            // Parse bizContent from response
            let bizContentResp = resData.bizContent;
            if (typeof bizContentResp === 'string') {
                bizContentResp = JSON.parse(bizContentResp);
            }

            // Parse accountInfo if present
            let accountInfo = bizContentResp.accountInfo;
            if (typeof accountInfo === 'string') {
                accountInfo = JSON.parse(accountInfo);
            }

            return {
                status: '200',
                code: 1,
                message: 'success',
                data: {
                    payOrderId: bizContentResp.platNo,
                    paymentUrl: bizContentResp.payUrl,
                    mchOrderNo: bizContentResp.mchOrderNo,
                    // Map F2PAY deep links with strict protocol transformation
                    deepLink: {
                        upi_scan: (accountInfo?.upiScan) ? `upi://pay?${accountInfo.upiScan}` : '',
                        upi_phonepe: accountInfo?.upiPhonepe || '',
                        upi_gpay: (accountInfo?.upiScan) ? `tez://upi/pay?${accountInfo.upiScan}` : '',
                        upi_paytm: (accountInfo?.upiIntent) ? `paytmmp://cash_wallet?${accountInfo.upiIntent}&featuretype=money_transfer` : '',
                        upi: accountInfo?.upi || '',
                        upi_intent: (accountInfo?.upiScan) ? `upi://pay?${accountInfo.upiScan}` : ''
                    },
                    accountInfo: accountInfo
                }
            };
        } else {
            console.error('[F2PAY] Create Payin Error:', resData);
            return {
                status: '500',
                code: 0,
                message: resData.msg || 'Failed to create order',
                data: null
            };
        }

    } catch (error) {
        const duration = Date.now() - startTime;
        logError('/payin/inr/order/createV2', error, requestBody);
        console.error('[F2PAY] API Error:', error.message);

        return {
            status: '500',
            code: 0,
            message: error.message || 'Network error',
            data: null
        };
    }
}

/**
 * Query Payin Order
 * Endpoint: POST /payin/query
 */
async function queryPayin(orderId, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const privateKey = config.privateKey || MERCHANT_PRIVATE_KEY;

    const traceId = generateTraceId('Q');

    const bizContent = {
        mchOrderNo: orderId
    };

    const bizContentStr = JSON.stringify(bizContent);
    const sign = createRsaSign(bizContentStr, privateKey);

    const requestBody = {
        traceId: traceId,
        merchantId: merchantId,
        bizContent: bizContentStr,
        signType: 'RSA',
        sign: sign
    };

    try {
        const response = await api.post('/payin/query', requestBody);
        const duration = Date.now() - startTime;

        logRequest('/payin/query', requestBody, response.data, duration);

        const resData = response.data;

        if (resData.code === '0000') {
            let bizContentResp = resData.bizContent;
            if (typeof bizContentResp === 'string') {
                bizContentResp = JSON.parse(bizContentResp);
            }

            // Map F2PAY state to our status
            let status = 0; // pending
            if (bizContentResp.state === 'Paid' || bizContentResp.state === 'UnequalPaid') {
                status = 1; // success
            } else if (bizContentResp.state === 'Expired' || bizContentResp.state === 'Failed') {
                status = 2; // failed
            }

            return {
                status: '200',
                code: 1,
                data: {
                    status: status,
                    state: bizContentResp.state,
                    amount: bizContentResp.amount,
                    actualAmount: bizContentResp.actualAmount,
                    utr: bizContentResp.trxId || '',
                    mchOrderNo: bizContentResp.mchOrderNo,
                    platNo: bizContentResp.platNo
                }
            };
        } else {
            return {
                status: '500',
                code: 0,
                message: resData.msg || 'Query failed'
            };
        }

    } catch (error) {
        logError('/payin/query', error, requestBody);
        return {
            status: '500',
            code: 0,
            message: error.message
        };
    }
}

/**
 * Create Payout Order
 * Endpoint: /payout/inr/order/create (Inferred)
 */
async function createPayout(data, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const privateKey = config.privateKey || MERCHANT_PRIVATE_KEY;

    const traceId = data.orderId || generateTraceId('OUT');

    // Build bizContent object based on Payout Query Response structure
    const bizContent = {
        mchOrderNo: data.orderId,
        amount: parseFloat(data.amount).toFixed(2),
        methodCode: 'BANK_INR', // From Test Params
        payeeName: data.name,
        payeeAccountNo: data.bankNo,
        payeeIfsc: data.ifsc, // Guessing field name (payeeIfsc vs ifsc)
        ifsc: data.ifsc,      // Sending both to be safe
        notifyUrl: data.notifyUrl
    };

    const bizContentStr = JSON.stringify(bizContent);
    const sign = createRsaSign(bizContentStr, privateKey);

    const requestBody = {
        traceId: traceId,
        merchantId: merchantId,
        bizContent: bizContentStr,
        signType: 'RSA',
        sign: sign
    };

    console.log(`[F2PAY] Creating Payout Order: ${data.orderId}`);

    try {
        // Warning: Endpoint inferred from Payin pattern
        const response = await api.post('/payout/inr/order/create', requestBody);
        const duration = Date.now() - startTime;

        logRequest('/payout/inr/order/create', requestBody, response.data, duration);

        const resData = response.data;

        if (resData.code === '0000') {
            let bizContentResp = resData.bizContent;
            if (typeof bizContentResp === 'string') {
                bizContentResp = JSON.parse(bizContentResp);
            }

            return {
                status: '200',
                code: 1,
                message: 'success',
                data: {
                    payOrderId: bizContentResp.platNo,
                    mchOrderNo: bizContentResp.mchOrderNo,
                    status: 'processing' // Assume processing on success
                }
            };
        } else {
            console.error('[F2PAY] Create Payout Error:', resData);
            return {
                status: '500',
                code: 0,
                message: resData.msg || 'Failed to create payout'
            };
        }

    } catch (error) {
        logError('/payout/inr/order/create', error, requestBody);
        return {
            status: '500',
            code: 0,
            message: error.message || 'Network error'
        };
    }
}

/**
 * Submit UTR for Order
 * Endpoint: POST /payin/inr/order/resubmit
 */
async function submitUtr(orderId, utr, config = {}) {
    const startTime = Date.now();
    const merchantId = config.merchantId || MERCHANT_ID;
    const privateKey = config.privateKey || MERCHANT_PRIVATE_KEY;

    const traceId = generateTraceId('UTR');

    const bizContent = {
        mchOrderNo: orderId,
        trxId: utr
    };

    const bizContentStr = JSON.stringify(bizContent);
    const sign = createRsaSign(bizContentStr, privateKey);

    const requestBody = {
        traceId: traceId,
        merchantId: merchantId,
        bizContent: bizContentStr,
        signType: 'RSA',
        sign: sign
    };

    try {
        const response = await api.post('/payin/inr/order/resubmit', requestBody);
        const duration = Date.now() - startTime;

        logRequest('/payin/inr/order/resubmit', requestBody, response.data, duration);

        const resData = response.data;

        if (resData.code === '0000') {
            return {
                status: '200',
                code: 1,
                message: 'UTR submitted successfully'
            };
        } else {
            return {
                status: '500',
                code: 0,
                message: resData.msg || 'UTR submission failed'
            };
        }

    } catch (error) {
        logError('/payin/inr/order/resubmit', error, requestBody);
        return {
            status: '500',
            code: 0,
            message: error.message
        };
    }
}

/**
 * Verify Payin Callback Signature
 * F2PAY sends bizContent as JSON string, sign is RSA signature of bizContent
 */
function verifyPayinCallback(callbackData, publicKeyOverride = null) {
    try {
        const { bizContent, sign } = callbackData;

        if (!bizContent || !sign) {
            console.error('[F2PAY] Callback missing bizContent or sign');
            return false;
        }

        // bizContent should be a JSON string
        const dataToVerify = typeof bizContent === 'string' ? bizContent : JSON.stringify(bizContent);

        return verifyRsaSign(dataToVerify, sign, publicKeyOverride);
    } catch (error) {
        console.error('[F2PAY] Callback verification error:', error);
        return false;
    }
}

/**
 * Parse Callback bizContent
 */
function parseCallbackBizContent(callbackData) {
    let bizContent = callbackData.bizContent;

    if (typeof bizContent === 'string') {
        try {
            bizContent = JSON.parse(bizContent);
        } catch (e) {
            console.error('[F2PAY] Failed to parse bizContent:', e);
            return null;
        }
    }

    return bizContent;
}

/**
 * Query Balance
 * Endpoint: POST /balance
 */
async function getBalance(currency = 'INR', config = {}) {
    const merchantId = config.merchantId || MERCHANT_ID;
    const privateKey = config.privateKey || MERCHANT_PRIVATE_KEY;

    const traceId = generateTraceId('BAL');

    const bizContent = { currency };
    const bizContentStr = JSON.stringify(bizContent);
    const sign = createRsaSign(bizContentStr, privateKey);

    const requestBody = {
        traceId: traceId,
        merchantId: merchantId,
        bizContent: bizContentStr,
        signType: 'RSA',
        sign: sign
    };

    try {
        const response = await api.post('/balance', requestBody);

        if (response.data.code === '0000') {
            let bizContentResp = response.data.bizContent;
            if (typeof bizContentResp === 'string') {
                bizContentResp = JSON.parse(bizContentResp);
            }

            return {
                status: '200',
                code: 1,
                data: {
                    total: bizContentResp.total,
                    available: bizContentResp.availiable, // Note: F2PAY typo
                    payinDisputed: bizContentResp.payinDisputed,
                    payinToBeSettled: bizContentResp.payinToBeSettled,
                    payoutPending: bizContentResp.payoutPending
                }
            };
        } else {
            return {
                status: '500',
                code: 0,
                message: response.data.msg
            };
        }

    } catch (error) {
        return {
            status: '500',
            code: 0,
            message: error.message
        };
    }
}

module.exports = {
    createPayinV2,
    queryPayin,
    createPayout,
    submitUtr,
    getBalance,
    verifyPayinCallback,
    parseCallbackBizContent,
    createRsaSign,
    verifyRsaSign
};
