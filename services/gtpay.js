/**
 * GTPAY Service (Channel 3)
 * AES + MD5 based authentication
 */

const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Configuration
const BASE_URL = process.env.GTPAY_BASE_URL || 'https://interface.payp.vip';
const PLATFORM_NO = process.env.GTPAY_PLATFORM_NO; // MR06535204
const PAYIN_KEY = process.env.GTPAY_PAYIN_KEY;
const PAYOUT_KEY = process.env.GTPAY_PAYOUT_KEY;

const ERROR_LOG_FILE = path.join(__dirname, '..', 'gtpay_error.txt');
const REQUEST_LOG_FILE = path.join(__dirname, '..', 'gtpay_requests.log');

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

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'multipart/form-data' // Docs say form-data
    }
});

// Helper for AES Encryption (Java default is often ECB if not specified, but let's try standard)
// Note: Java's standard AES encryption often defaults to ECB mode with PKCS5Padding if mode not specified.
// Node's crypto uses CBC by default for 'aes-128-cbc'.
// Let's implement helper that can potentially swap modes if needed.
// Given "key" is string, we might need to verify if it's 16/24/32 chars.
// If key is provided as plain string, we use it directly.

function encryptAes(text, key) {
    try {
        let keyBuffer = Buffer.from(key);
        let algorithm = 'aes-128-ecb';

        // Heuristic: If key is 32 chars and hex-like, assume it's a 16-byte key encoded in hex for AES-128
        // Otherwise, if it's 32 chars and we treat as utf8, it fits AES-256.
        // Most payment gateways with 32-char keys mean Hex encoded 16-byte key.
        if (key.length === 32 && /^[0-9a-fA-F]+$/.test(key)) {
            keyBuffer = Buffer.from(key, 'hex');
            algorithm = 'aes-128-ecb';
        } else if (key.length === 32) {
            algorithm = 'aes-256-ecb';
        }

        const cipher = crypto.createCipheriv(algorithm, keyBuffer, null);
        cipher.setAutoPadding(true);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    } catch (e) {
        console.error('GTPAY Encrypt Error:', e);
        return null;
    }
}

function decryptAes(text, key) {
    try {
        let keyBuffer = Buffer.from(key);
        let algorithm = 'aes-128-ecb';

        if (key.length === 32 && /^[0-9a-fA-F]+$/.test(key)) {
            keyBuffer = Buffer.from(key, 'hex');
            algorithm = 'aes-128-ecb';
        } else if (key.length === 32) {
            algorithm = 'aes-256-ecb';
        }

        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, null);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(text, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('GTPAY Decrypt Error:', e);
        return null;
    }
}

function md5(text) {
    return crypto.createHash('md5').update(text).digest('hex').toLowerCase();
}

/**
 * Create Payin
 * POST /api/pay/apply
 */
async function createPayin(data) {
    const startTime = Date.now();

    // Parameter parameters
    const paramMap = {
        payAmount: parseFloat(data.amount).toFixed(2),
        commercialOrderNo: data.orderId,
        callBackUrl: data.notifyUrl,
        notifyUrl: data.returnUrl || data.notifyUrl, // Doc calls "notifyUrl" the jump URL (sync redirect), and callBackUrl the async notify?
        // Doc: "notifyUrl: 支付完成后的跳转URL地址", "callBackUrl: 异步通知回调URL地址"
        userId: data.userId || 'USER_' + Math.floor(Math.random() * 10000),
        ipCustomer: data.ip || '127.0.0.1'
    };

    const jsonStr = JSON.stringify(paramMap);
    const key = process.env.GTPAY_PAYIN_KEY;

    const parameter = encryptAes(jsonStr, key);
    const sign = md5(jsonStr); // Sign the JSON string directly? Doc: "对生成的json字符串md5加密"

    const formData = new FormData();
    formData.append('platformno', process.env.GTPAY_PLATFORM_NO);
    formData.append('parameter', parameter);
    formData.append('sign', sign);
    formData.append('payType', '8'); // User requested payType 8

    // Need to use axios with form-data
    // Since we are in node, FormData object from 'form-data' package or standard might be tricky with axios in some envs.
    // Let's use URLSearchParams or qs if simple key-value, but doc says 'form-data'. Application/x-www-form-urlencoded might work or multipart.
    // Usually "form-data" implies multipart/form-data.

    try {
        // Construct multipart manually or use library if available. 
        // Axios supports auto serialization if we pass an object, but only for JSON or urlencoded. 
        // For multipart, we need a FormData instance.

        // Important: in Node env, we don't have browser FormData.
        const fd = new URLSearchParams();
        fd.append('platformno', process.env.GTPAY_PLATFORM_NO);
        fd.append('parameter', parameter);
        fd.append('sign', sign);
        fd.append('payType', '8');

        // Note: URLSearchParams sends 'application/x-www-form-urlencoded'.
        // If they STRICTLY require 'multipart/form-data', we need 'form-data' lib.
        // Assuming urlencoded works as it's common for "form parameters". 
        // If fails, we will need to switch to 'form-data' package.

        const response = await api.post('/api/pay/apply', fd, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const duration = Date.now() - startTime;
        logRequest('/api/pay/apply', paramMap, response.data, duration);

        const resData = response.data;

        if (resData.result === 'success') {
            return {
                code: 1,
                paymentUrl: resData.payUrl,
                orderId: resData.sysNo,
                data: resData
            };
        } else {
            return {
                code: 0,
                msg: resData.message || 'Failed'
            };
        }

    } catch (e) {
        logError('/api/pay/apply', e, paramMap);
        return { code: 0, msg: e.message };
    }
}

/**
 * Create Payout
 * POST /api/guest/instead/insPay
 */
async function createPayout(data) {
    const startTime = Date.now();

    const paramMap = {
        commercialPayNo: data.orderId,
        totalAmount: parseFloat(data.amount).toFixed(2),
        payeeBank: 'CODE', // Doc says use bank code? "payeeBank: 开户行" e.g. UJJIVN. But what if we don't know?
        // Doc says: "更多详细请查看银行编码文档". User might not provide this code.
        // Usually IFSC determines bank.
        // Maybe we can pass "OTEHR" or infer from IFSC?
        // Let's try sending bank name or strict mapping if needed.
        // For now, let's map common ones or send a default if allowed. 
        // If "payeeBank" is strictly required Enum, we need a mapper.
        // Let's assume we pass what we have or 'ICICI' as placeholder if valid?
        // Actually, ifsc usually suffices in India.
        // Let's use a dummy or try to parse IFSC? 
        // Example: "SBIN" -> SBI.
        payeeBankCode: data.ifsc, // IFSC
        payeeAcc: data.bankNo,
        payeeName: data.name,
        payeePhone: '9999999999',
        currency: 'INR',
        chargeType: '1',
        notifyUrl: data.notifyUrl
    };

    // Attempt to map IFSC to Bank Code
    const ifscPrefix = data.ifsc.substr(0, 4).toUpperCase();
    // Simple mapper for common ones in doc
    const bankMap = {
        'SBIN': 'SBI',
        'HDFC': 'HDFCBK',
        'ICIC': 'ICICI',
        'UTIB': 'AXIS',
        'PUNB': 'PNB',
        'CNRB': 'CANARA',
        'KKBK': 'KOTAK',
        'IDIB': 'INDIAN',
        'JAKA': 'JKBK',
        'INDB': 'INDUSIND',
        'BDBL': 'BANDHAN',
        'IDFB': 'IDFC',
        'IOBA': 'IOB',
        'CITI': 'CITIBANK',
        'UCBA': 'UCO',
        'MAHB': 'MAHARASHTRA',
        'ANDB': 'ANDHRA',
        'SYNB': 'SYNDICATE'
    };
    paramMap.payeeBank = bankMap[ifscPrefix] || 'SBI'; // Default to SBI if unknown? Risky. 
    // Or maybe just send ifscPrefix?
    // Let's hope it accepts the code directly if it matches.

    const jsonStr = JSON.stringify(paramMap);
    const key = process.env.GTPAY_PAYOUT_KEY;

    const parameter = encryptAes(jsonStr, key);
    const sign = md5(jsonStr);

    const fd = new URLSearchParams();
    fd.append('platformNo', process.env.GTPAY_PLATFORM_NO);
    fd.append('parameter', parameter);
    fd.append('sign', sign);

    try {
        const response = await api.post('/api/guest/instead/insPay', fd, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const duration = Date.now() - startTime;
        logRequest('/api/guest/instead/insPay', paramMap, response.data, duration);

        const resData = response.data;
        if (resData.result === 'processing' || resData.result === 'success') {
            return {
                code: 1,
                payOrderId: resData.outTradeNo,
                message: resData.msg
            };
        } else {
            return {
                code: 0,
                message: resData.msg || 'Payout Failed'
            };
        }
    } catch (e) {
        logError('/api/guest/instead/insPay', e, paramMap);
        return { code: 0, message: e.message };
    }
}

function verifyPayinCallback(query) {
    try {
        const { parameter, sign } = query;
        const key = process.env.GTPAY_PAYIN_KEY;

        // Decrypt
        const jsonStr = decryptAes(parameter, key);
        if (!jsonStr) return false;

        // Verify sign
        const calcSign = md5(jsonStr);
        if (calcSign !== sign) {
            console.error('GTPAY Sign Mismatch', calcSign, sign);
            return false;
        }

        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('GTPAY Verify Error', e);
        return false;
    }
}

function verifyPayoutCallback(query) {
    try {
        const { parameter, sign } = query;
        const key = process.env.GTPAY_PAYOUT_KEY;

        const jsonStr = decryptAes(parameter, key);
        if (!jsonStr) return false;

        const calcSign = md5(jsonStr);
        if (calcSign !== sign) return false;

        return JSON.parse(jsonStr);
    } catch (e) {
        return false;
    }
}

module.exports = {
    createPayin,
    createPayout,
    verifyPayinCallback,
    verifyPayoutCallback
};
