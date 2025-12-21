const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const silkpayService = require('./silkpay');
const { calculatePayinFee, getUserRates } = require('../utils/rates');
const { generateOrderId } = require('../utils/signature');

/**
 * Create a new Payin Order
 * ...
 */
async function createPayinOrder({ amount, orderId, merchant, callbackUrl, skipUrl, param }) {
    const db = getDb();
    // ... (lines 20-36)

    const rates = await getUserRates(db, merchant.id); // Use User Specific Rates
    const { fee, netAmount } = calculatePayinFee(numericAmount, rates.payinRate);

    // Use finalOrderId (Merchant's ID) for Silkpay interaction to ensure match
    // Note: order_id is globally unique in our DB, so this is safe for Silkpay mid.
    const silkpayOrderId = finalOrderId;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const ourCallbackUrl = `${appUrl}/api/payin/callback`;
    const ourSkipUrl = `${appUrl}/api/payin/redirect?url=${encodeURIComponent(skipUrl || `${appUrl}/payment/complete`)}`;

    // Demo User Override
    let silkpayConfig = {};
    if (merchant.username === 'demo') {
        silkpayConfig = {
            baseUrl: 'https://api.dev.silkpay.ai',
            mid: 'TEST',
            secret: 'SIb3DQEBAQ'
        };
        console.log(`[Demo] Using Sandbox for Order ${silkpayOrderId}`);
    }

    // Call Silkpay
    const silkpayResponse = await silkpayService.createPayin({
        orderAmount: numericAmount,
        orderId: silkpayOrderId,
        notifyUrl: ourCallbackUrl,
        returnUrl: ourSkipUrl
    }, silkpayConfig);

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
    // platform_order_id -> silkpayResponse.data.payOrderId || silkpayOrderId (fallback)
    const platformOrderId = silkpayResponse.data.payOrderId || silkpayOrderId;
    const paymentUrl = silkpayResponse.data.paymentUrl;

    // --- UPI ID Extraction Logic ---
    try {
        if (deepLinks && typeof deepLinks === 'object') {
            const upiIds = new Set();
            Object.values(deepLinks).forEach(url => {
                if (typeof url === 'string') {
                    try {
                        const match = url.match(/[?&]pa=([^&]+)/);
                        if (match && match[1]) {
                            upiIds.add(decodeURIComponent(match[1]));
                        }
                    } catch (e) { }
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
            }
        }
    } catch (e) {
        console.error('Error extracting UPI IDs:', e);
    }
    // -----------------------------

    await db.prepare(`
        INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param)
        VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?)
    `).run(txUuid, merchant.id, finalOrderId, platformOrderId, numericAmount, numericAmount, fee, netAmount, paymentUrl, storedParam);

    // --- INSTANT CALLBACK REMOVED (Handled by Upstream) ---
    // if (merchant.username === 'demo') { ... }
    // ------------------------------------------------------

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
