const axios = require('axios');
const fs = require('fs');
const path = require('path');
const payableConfig = require('../config/payable');
const { generateSign } = require('../utils/signature');

const ERROR_LOG_FILE = path.join(__dirname, '..', 'error.txt');

// Log API errors to error.txt
function logApiError(endpoint, error, requestData) {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] PAYABLE API ERROR
Endpoint: ${endpoint}
Request: ${JSON.stringify(requestData, null, 2)}
Error: ${error.message || error}
${error.response ? `Response: ${JSON.stringify(error.response.data)}` : ''}
---\n`;

    try {
        fs.appendFileSync(ERROR_LOG_FILE, errorMessage);
    } catch (e) {
        console.error('Failed to write to error log:', e);
    }
}

// Log all API requests
function logApiRequest(endpoint, requestData, response) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] PAYABLE API: ${endpoint}`);
    console.log('Request:', JSON.stringify(requestData));
    console.log('Response:', JSON.stringify(response));
}

const api = axios.create({
    baseURL: payableConfig.baseUrl,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

/**
 * Query Payable balance
 */
async function queryBalance() {
    const params = {
        userId: payableConfig.userId
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.balance, params);
        logApiRequest('balance', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('balance', error, params);
        throw error;
    }
}

/**
 * Create a pay-in (recharge) order
 * @param {object} data - { orderAmount, orderId, callbackUrl, skipUrl, param }
 */
async function createPayin(data) {
    const params = {
        userId: payableConfig.userId,
        orderAmount: data.orderAmount,
        orderId: data.orderId,
        callbackUrl: data.callbackUrl,
        skipUrl: data.skipUrl,
        param: data.param || ''
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.payin, params);
        logApiRequest('createPayin', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('createPayin', error, params);
        throw error;
    }
}

/**
 * Query pay-in order status
 * @param {string} orderId - Merchant order ID
 */
async function queryPayin(orderId) {
    const params = {
        userId: payableConfig.userId,
        orderId: orderId
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.payinQuery, params);
        logApiRequest('queryPayin', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('queryPayin', error, params);
        throw error;
    }
}

/**
 * Create a payout order
 * @param {object} data - { amount, orderId, account, ifsc, personName, callbackUrl, param }
 */
async function createPayout(data) {
    const params = {
        userId: payableConfig.userId,
        amount: data.amount,
        orderId: data.orderId,
        account: data.account,
        ifsc: data.ifsc,
        personName: data.personName,
        callbackUrl: data.callbackUrl,
        param: data.param || ''
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.payout, params);
        logApiRequest('createPayout', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('createPayout', error, params);
        throw error;
    }
}

/**
 * Query payout order status
 * @param {string} orderId - Merchant order ID
 */
async function queryPayout(orderId) {
    const params = {
        userId: payableConfig.userId,
        orderId: orderId
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.payoutQuery, params);
        logApiRequest('queryPayout', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('queryPayout', error, params);
        throw error;
    }
}

/**
 * UTR supplement order
 * @param {string} orderId - Merchant order ID
 * @param {string} utr - UTR number
 */
async function utrOrder(orderId, utr) {
    const params = {
        userId: payableConfig.userId,
        orderId: orderId,
        utr: utr
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.utrOrder, params);
        logApiRequest('utrOrder', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('utrOrder', error, params);
        throw error;
    }
}

/**
 * Query UTR status
 * @param {string} utr - UTR number
 */
async function queryUtr(utr) {
    const params = {
        userId: payableConfig.userId,
        utr: utr
    };
    params.sign = generateSign(params, payableConfig.secret);

    try {
        const response = await api.post(payableConfig.endpoints.utrQuery, params);
        logApiRequest('queryUtr', params, response.data);
        return response.data;
    } catch (error) {
        logApiError('queryUtr', error, params);
        throw error;
    }
}

module.exports = {
    queryBalance,
    createPayin,
    queryPayin,
    createPayout,
    queryPayout,
    utrOrder,
    queryUtr
};
