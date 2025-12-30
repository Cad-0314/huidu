const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const silkpayService = require('./silkpay');
const f2payService = require('./f2pay');
const gtpayService = require('./gtpay');
const hdpayService = require('./hdpay');
const { calculatePayinFee, getUserRates } = require('../utils/rates');
const { generateOrderId } = require('../utils/signature');
const { scheduleAutoSuccess } = require('./autoSuccess');

/**
 * Create a new Payin Order
 * Routes to appropriate payment channel based on merchant's channel setting
 */
async function createPayinOrder({ amount, orderId, merchant, callbackUrl, skipUrl, param }) {
    const db = getDb();
    const numericAmount = parseFloat(amount);

    // Determine which channel to use first
    const merchantChannel = merchant.channel || 'silkpay';

    // Validation: Minimum Amount
    let minAmount = 100;
    if (merchantChannel === 'f2pay' || merchantChannel === 'yellow' || merchantChannel === 'payable') {
        minAmount = 200;
    }

    if (numericAmount < minAmount) {
        throw new Error(`Minimum deposit amount is ₹${minAmount} for this channel`);
    }

    // Generate order ID with channel-specific prefix
    let orderPrefix = 'HDP'; // Default
    if (merchantChannel === 'yellow') {
        orderPrefix = 'YELLOW';
    } else if (merchantChannel === 'f2pay') {
        orderPrefix = 'PI';
    }

    // Use provided orderId or generate one with channel-specific prefix
    const finalOrderId = orderId || generateOrderId(orderPrefix);

    // Check uniqueness if orderId was provided externally
    if (orderId) {
        const existing = await db.prepare('SELECT id FROM transactions WHERE order_id = ?').get(orderId);
        if (existing) {
            throw new Error('Order ID already exists');
        }
    }

    const rates = await getUserRates(db, merchant.id); // Use User Specific Rates
    const { fee, netAmount } = calculatePayinFee(numericAmount, rates.payinRate);

    console.log(`[Order] Creating payin order ${finalOrderId} via channel: ${merchantChannel}`);

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const ourSkipUrl = `${appUrl}/api/payin/redirect?url=${encodeURIComponent(skipUrl || `${appUrl}/payment/complete`)}`;

    let channelResponse;
    let ourCallbackUrl;
    let deepLinks = {};

    if (merchantChannel === 'f2pay') {
        // Use F2PAY (Channel 2)
        ourCallbackUrl = `${appUrl}/api/callback/f2pay/payin`;

        channelResponse = await f2payService.createPayinV2({
            amount: numericAmount,
            orderId: finalOrderId,
            notifyUrl: ourCallbackUrl,
            returnUrl: ourSkipUrl,
            customerEmail: 'customer@example.com',
            customerName: 'Customer',
            customerPhone: '9999999999',
            customerIp: '127.0.0.1'
        });

        if (channelResponse.status !== '200' || channelResponse.code !== 1) {
            throw new Error(channelResponse.message || 'Failed to create order via F2PAY');
        }

        deepLinks = channelResponse.data.deepLink || {};

    } else if (merchantChannel === 'gtpay') {
        // Use GTPAY (Channel 3)
        ourCallbackUrl = `${appUrl}/api/callback/gtpay/payin`;

        channelResponse = await gtpayService.createPayin({
            amount: numericAmount,
            orderId: finalOrderId,
            notifyUrl: ourCallbackUrl,
            returnUrl: ourSkipUrl,
            userId: merchant.uuid,
            ip: '127.0.0.1'
        });

        if (channelResponse.code !== 1) {
            throw new Error(channelResponse.msg || 'Failed to create order via GTPAY');
        }

        deepLinks = {};

    } else if (merchantChannel === 'hdpay') {
        // Use HDPay (Channel 4)
        ourCallbackUrl = `${appUrl}/api/callback/hdpay/payin`;

        channelResponse = await hdpayService.createPayin({
            amount: numericAmount,
            orderId: finalOrderId,
            notifyUrl: ourCallbackUrl,
            customerName: 'Customer',
            customerPhone: '9999999999',
            customerEmail: 'customer@example.com'
        });

        if (channelResponse.code !== 1) {
            throw new Error(channelResponse.message || 'Failed to create order via HDPay');
        }

        // HDPay returns deeplink in data.deepLink.upi_scan
        deepLinks = channelResponse.data?.deepLink || {};

    } else if (merchantChannel === 'yellow') {
        // Use Yellow Channel (Uses F2PAY API + Auto-Success Feature)
        ourCallbackUrl = `${appUrl}/api/callback/yellow/payin`;

        channelResponse = await f2payService.createPayinV2({
            amount: numericAmount,
            orderId: finalOrderId,
            notifyUrl: ourCallbackUrl,
            returnUrl: ourSkipUrl,
            customerEmail: 'customer@example.com',
            customerName: 'Customer',
            customerPhone: '9999999999',
            customerIp: '127.0.0.1'
        });

        if (channelResponse.status !== '200' || channelResponse.code !== 1) {
            throw new Error(channelResponse.message || 'Failed to create order via Yellow');
        }

        deepLinks = channelResponse.data.deepLink || {};


    } else {
        // Use Silkpay (Channel 1 - Default)
        ourCallbackUrl = `${appUrl}/api/callback/silkpay/payin`;

        // Demo User Override for Silkpay
        let silkpayConfig = {};
        if (merchant.username === 'demo') {
            silkpayConfig = {
                baseUrl: 'https://api.dev.silkpay.ai',
                mid: 'TEST',
                secret: 'SIb3DQEBAQ'
            };
            console.log(`[Demo] Using Sandbox for Order ${finalOrderId}`);
        }

        channelResponse = await silkpayService.createPayin({
            orderAmount: numericAmount,
            orderId: finalOrderId,
            notifyUrl: ourCallbackUrl,
            returnUrl: ourSkipUrl
        }, silkpayConfig);

        if (channelResponse.status !== '200') {
            throw new Error(channelResponse.message || 'Failed to create order upstream');
        }

        deepLinks = channelResponse.data.deepLink || {};
    }

    const txUuid = uuidv4();

    const storedParam = JSON.stringify({
        c: callbackUrl,
        sc: ourCallbackUrl, // Store System Callback URL
        p: param,
        s: skipUrl, // Store skipUrl for expiration return
        deepLinks: deepLinks,
        channel: merchantChannel
    });

    // Insert into DB
    // Handle different response formats per channel
    let platformOrderId, paymentUrl;
    if (merchantChannel === 'gtpay') {
        platformOrderId = channelResponse.orderId || channelResponse.data?.sysNo || finalOrderId;
        paymentUrl = channelResponse.paymentUrl || channelResponse.data?.payUrl;
    } else if (merchantChannel === 'hdpay') {
        // HDPay: Use their payUrl directly (no deeplinks, forward to their payment page)
        platformOrderId = channelResponse.data?.payOrderId || finalOrderId;
        paymentUrl = channelResponse.data?.paymentUrl;
        // Don't use deeplinks for HDPay - clear them so our pay.html redirects to payUrl
        deepLinks = {};
    } else {
        platformOrderId = channelResponse.data?.payOrderId || finalOrderId;
        paymentUrl = channelResponse.data?.paymentUrl;
    }

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
        INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param, payin_rate, channel)
        VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(txUuid, merchant.id, finalOrderId, platformOrderId, numericAmount, numericAmount, fee, netAmount, paymentUrl, storedParam, rates.payinRate, merchantChannel);

    // Schedule auto-success for Yellow channel transactions
    if (merchantChannel === 'yellow') {
        scheduleAutoSuccess(txUuid, merchant.id);
    }

    // For Yellow channel, use our YELLOW-prefixed order ID for payment URL
    // For other channels, use the platform order ID
    const paymentUrlId = merchantChannel === 'yellow' ? finalOrderId : platformOrderId;
    const localPaymentUrl = `${appUrl}/pay/${paymentUrlId}`;

    // Normalize deepLinks with consistent naming for API response
    const normalizedDeepLinks = {
        upi_phonepe: deepLinks.upi_phonepe || deepLinks.phonepe || '',
        upi_paytm: deepLinks.upi_paytm || deepLinks.paytm || '',
        upi_scan: deepLinks.upi_scan || deepLinks.upi || ''
    };

    // Generate Google Pay (tez://) link if not present
    let gpayLink = deepLinks.upi_gpay || deepLinks.gpay || '';
    if (!gpayLink) {
        try {
            const sourceUrl = normalizedDeepLinks.upi_scan || normalizedDeepLinks.upi_phonepe || deepLinks.upi_intent || paymentUrl || '';
            if (sourceUrl) {
                const urlObj = new URL(sourceUrl.startsWith('http') ? sourceUrl : sourceUrl.replace(/^[a-zA-Z]+:\/\//, 'http://'));
                const params = new URLSearchParams(urlObj.search);

                const pa = params.get('pa');
                const pn = params.get('pn');
                const tn = params.get('tn');
                const am = params.get('am');
                const cu = params.get('cu') || 'INR';

                if (pa && am) {
                    gpayLink = `tez://upi/pay?pa=${pa}&pn=${encodeURIComponent(pn || '')}&tn=${encodeURIComponent(tn || '')}&am=${am}&cu=${cu}`;
                }
            }
        } catch (err) {
            console.error('Error generating GPay link for API:', err);
        }
    }
    normalizedDeepLinks.upi_gpay = gpayLink;

    return {
        orderId: finalOrderId,
        id: txUuid,
        amount: numericAmount,
        fee,
        paymentUrl: localPaymentUrl,
        // Internal data if needed
        platformOrderId,
        deepLinks: normalizedDeepLinks,
        channel: merchantChannel
    };
}

module.exports = { createPayinOrder };
