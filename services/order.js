const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const silkpayService = require('./silkpay');
const { calculatePayinFee, getRatesFromDb } = require('../utils/rates');
const { generateOrderId } = require('../utils/signature');

/**
 * Create a new Payin Order
 * @param {Object} params
 * @param {number|string} params.amount
 * @param {string} params.orderId - Merchant's Order ID (or auto-generated if null)
 * @param {Object} params.merchant - Merchant user object
 * @param {string} params.callbackUrl - Merchant's callback URL
 * @param {string} params.skipUrl - Return URL
 * @param {string} params.param - Extra params
 * @returns {Promise<Object>} Result
 */
async function createPayinOrder({ amount, orderId, merchant, callbackUrl, skipUrl, param }) {
    const db = getDb();
    const numericAmount = parseFloat(amount);

    if (numericAmount < 100) {
        throw new Error('Minimum deposit amount is ₹100');
    }

    // Use provided orderId or generate one
    const finalOrderId = orderId || generateOrderId('HDP');

    // Check uniqueness if orderId was provided externally
    if (orderId) {
        const existing = await db.prepare('SELECT id FROM transactions WHERE order_id = ?').get(orderId);
        if (existing) {
            throw new Error('Order ID already exists');
        }
    }

    const rates = await getRatesFromDb(db);
    const { fee, netAmount } = calculatePayinFee(numericAmount, rates.payinRate);

    const internalOrderId = generateOrderId('HDP'); // Internal ID for Silkpay interaction
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const ourCallbackUrl = `${appUrl}/api/payin/callback`;
    const ourSkipUrl = skipUrl || `${appUrl}/payment/complete`;

    // Call Silkpay
    const silkpayResponse = await silkpayService.createPayin({
        orderAmount: numericAmount,
        orderId: internalOrderId,
        notifyUrl: ourCallbackUrl,
        returnUrl: ourSkipUrl
    });

    if (silkpayResponse.status !== '200') {
        throw new Error(silkpayResponse.message || 'Failed to create order upstream');
    }

    const txUuid = uuidv4();
    const deepLinks = silkpayResponse.data.deepLink || {};

    const storedParam = JSON.stringify({
        c: callbackUrl,
        p: param,
        s: skipUrl, // Store skipUrl for expiration return
        deepLinks: deepLinks
    });

    // Insert into DB
    // We map: order_id (Merchant's) -> finalOrderId
    // platform_order_id (Silkpay's) -> silkpayResponse.data.payOrderId || internalOrderId
    const platformOrderId = silkpayResponse.data.payOrderId || internalOrderId;
    const paymentUrl = silkpayResponse.data.paymentUrl;

    // --- UPI ID Extraction Logic ---
    try {
        if (deepLinks && typeof deepLinks === 'object') {
            const upiIds = new Set();
            Object.values(deepLinks).forEach(url => {
                if (typeof url === 'string') {
                    try {
                        // Extract 'pa' parameter from UPI intent link
                        // Format: upi://pay?pa=someone@upi&...
                        const match = url.match(/[?&]pa=([^&]+)/);
                        if (match && match[1]) {
                            upiIds.add(decodeURIComponent(match[1]));
                        }
                    } catch (e) {
                        // Ignore parsing errors for individual links
                    }
                }
            });

            if (upiIds.size > 0) {
                const insertStmt = db.prepare(`
                    INSERT INTO upi_records (upi_id, is_ours, source) 
                    VALUES (?, 1, ?) 
                    ON CONFLICT(upi_id) DO NOTHING
                `);

                for (const upiId of upiIds) {
                    await insertStmt.run(upiId, 'VSPAY_Order');
                }
                console.log(`Extracted and saved ${upiIds.size} UPI IDs from order ${finalOrderId}`);
            }
        }
    } catch (extractionError) {
        console.error('Error extracting UPI IDs:', extractionError);
        // Do not fail the order creation if extraction fails
    }
    // -----------------------------

    await db.prepare(`
        INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param)
        VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?)
    `).run(txUuid, merchant.id, finalOrderId, platformOrderId, numericAmount, numericAmount, fee, netAmount, paymentUrl, storedParam);

    const localPaymentUrl = `${appUrl}/pay/${platformOrderId}`;

    return {
        orderId: finalOrderId,
        id: txUuid,
        amount: numericAmount,
        fee,
        paymentUrl: localPaymentUrl,
        // Internal data if needed
        platformOrderId
    };
}

module.exports = { createPayinOrder };
