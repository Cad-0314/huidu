const crypto = require('crypto');

/**
 * Generate MD5 signature following Payable API specification
 * 1. Sort parameters by ASCII code ascending
 * 2. Remove empty values
 * 3. Join with & in key=value format
 * 4. Append &secret=SECRET_KEY
 * 5. MD5 hash and convert to uppercase
 */
function generateSign(params, secret) {
    // Filter out empty values and sign itself
    const filteredParams = {};
    for (const key of Object.keys(params)) {
        if (key !== 'sign' && params[key] !== null && params[key] !== undefined && params[key] !== '') {
            filteredParams[key] = params[key];
        }
    }

    // Sort keys by ASCII
    const sortedKeys = Object.keys(filteredParams).sort();

    // Build query string
    const queryParts = sortedKeys.map(key => `${key}=${filteredParams[key]}`);
    const queryString = queryParts.join('&');

    // Append secret
    const signString = `${queryString}&secret=${secret}`;

    // MD5 hash and uppercase
    const hash = crypto.createHash('md5').update(signString).digest('hex');
    return hash.toUpperCase();
}

/**
 * Verify incoming signature
 */
function verifySign(params, secret) {
    const receivedSign = params.sign;
    if (!receivedSign) return false;

    const calculatedSign = generateSign(params, secret);
    return receivedSign.toUpperCase() === calculatedSign;
}

/**
 * Generate a unique merchant key
 */
function generateMerchantKey() {
    const uuid = require('uuid').v4();
    return 'MK_' + uuid.replace(/-/g, '').substring(0, 24).toUpperCase();
}

/**
 * Generate a unique order ID
 */
function generateOrderId(prefix = 'HD') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
}

module.exports = {
    generateSign,
    verifySign,
    generateMerchantKey,
    generateOrderId
};
