const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const silkpayService = require('../services/silkpay');
const { calculatePayinFee, getRatesFromDb } = require('../utils/rates');
const { generateOrderId, generateSign } = require('../utils/signature');

/**
 * POST /api/payin/create
 */
router.post('/create', apiAuthenticate, async (req, res) => {
    try {
        const { orderAmount, orderId, callbackUrl, skipUrl, param } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!orderAmount || !orderId) {
            return res.status(400).json({ code: 0, msg: 'orderAmount and orderId are required' });
        }

        const amount = parseFloat(orderAmount);

        // Minimum deposit: ₹100
        if (amount < 100) {
            return res.status(400).json({ code: 0, msg: 'Minimum deposit amount is ₹100' });
        }

        const existing = await db.prepare('SELECT id FROM transactions WHERE order_id = ?').get(orderId);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Order ID already exists' });
        }

        const rates = await getRatesFromDb(db);
        const { fee, netAmount } = calculatePayinFee(amount, rates.payinRate);

        const internalOrderId = generateOrderId('HDP');
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const ourCallbackUrl = `${appUrl}/api/payin/callback`;
        const ourSkipUrl = skipUrl || `${appUrl}/payment/complete`;

        const silkpayResponse = await silkpayService.createPayin({
            orderAmount: orderAmount,
            orderId: internalOrderId,
            notifyUrl: ourCallbackUrl,
            returnUrl: ourSkipUrl
        });

        if (silkpayResponse.status !== '200') {
            return res.status(400).json({ code: 0, msg: silkpayResponse.message || 'Failed to create order' });
        }

        const txUuid = uuidv4();

        // Wrap callbackUrl and original param into stored param to preserve dynamic callback capability
        const storedParam = JSON.stringify({
            c: callbackUrl,
            p: param
        });

        // Note: we store silkpay's payOrderId in platform_order_id. mOrderId is not explicitly stored but is internalOrderId.
        await db.prepare(`
            INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param)
            VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(txUuid, merchant.id, orderId, silkpayResponse.data.payOrderId || internalOrderId, amount, amount, fee, netAmount, silkpayResponse.data.paymentUrl, storedParam);

        // Return local payment page URL
        const localPaymentUrl = `${appUrl}/pay/${silkpayResponse.data.payOrderId || internalOrderId}`;

        // Extract deeplinks from Silkpay response
        const deepLinks = silkpayResponse.data.deepLink || {};

        res.json({
            code: 1,
            msg: 'Order created',
            data: {
                orderId,
                id: txUuid,
                orderAmount: amount,
                fee,
                paymentUrl: localPaymentUrl,
                silkpayPaymentUrl: silkpayResponse.data.paymentUrl,
                deepLink: deepLinks
            }
        });
    } catch (error) {
        console.error('Create payin error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payin/query
 */
router.post('/query', apiAuthenticate, async (req, res) => {
    try {
        const { orderId } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!orderId) {
            return res.status(400).json({ code: 0, msg: 'orderId is required' });
        }

        const tx = await db.prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?').get(orderId, merchant.id);

        if (!tx) {
            return res.status(404).json({ code: 0, msg: 'Order not found' });
        }

        res.json({
            code: 1,
            data: {
                orderId: tx.order_id, id: tx.uuid, status: tx.status, amount: tx.amount,
                orderAmount: tx.order_amount, fee: tx.fee, netAmount: tx.net_amount,
                utr: tx.utr, createdAt: tx.created_at
            }
        });
    } catch (error) {
        console.error('Query payin error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payin/check - Public order check API for clients
 * Clients can check order status with orderId and userId
 */
router.post('/check', async (req, res) => {
    try {
        const { orderId, userId } = req.body;
        const db = getDb();

        if (!orderId || !userId) {
            return res.status(400).json({ code: 0, msg: 'orderId and userId are required' });
        }

        // Find user by uuid
        const user = await db.prepare('SELECT id FROM users WHERE uuid = ?').get(userId);
        if (!user) {
            return res.status(404).json({ code: 0, msg: 'Invalid userId' });
        }

        const tx = await db.prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?').get(orderId, user.id);

        if (!tx) {
            return res.status(404).json({ code: 0, msg: 'Order not found' });
        }

        res.json({
            code: 1,
            msg: 'Order found',
            data: {
                orderId: tx.order_id,
                id: tx.uuid,
                status: tx.status,
                amount: tx.amount,
                orderAmount: tx.order_amount,
                fee: tx.fee,
                netAmount: tx.net_amount,
                utr: tx.utr,
                createdAt: tx.created_at,
                updatedAt: tx.updated_at
            }
        });
    } catch (error) {
        console.error('Check order error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payin/check-utr - Check order status by UTR
 */
router.post('/check-utr', async (req, res) => {
    try {
        const { utr, userId } = req.body;
        const db = getDb();

        if (!utr) {
            return res.status(400).json({ code: 0, msg: 'UTR is required' });
        }

        // Optional: validate userId if provided, or just search globally if UTR is unique enough
        // For security, checking user context is better
        let userIdVal = null;
        if (userId) {
            const user = await db.prepare('SELECT id FROM users WHERE uuid = ?').get(userId);
            if (user) userIdVal = user.id;
        }

        let query = 'SELECT * FROM transactions WHERE utr = ?';
        const params = [utr];
        if (userIdVal) {
            query += ' AND user_id = ?';
            params.push(userIdVal);
        }

        const tx = await db.prepare(query).get(...params);

        if (tx) {
            return res.json({
                code: 1,
                msg: 'Order found locally',
                data: {
                    orderId: tx.order_id,
                    id: tx.uuid,
                    status: tx.status,
                    amount: tx.amount,
                    utr: tx.utr,
                    createdAt: tx.created_at
                }
            });
        }

        // If not found locally, check upstream
        try {
            const upstream = await silkpayService.queryUtr(utr);
            if (upstream.status === '200' && upstream.data?.code === 1) {
                // Upstream found it
                return res.json({
                    code: 1,
                    msg: 'Order found upstream',
                    data: {
                        orderId: upstream.data.mOrderId, // This might be null if not bound
                        status: 1, // 'code' 1 means success/usable
                        amount: upstream.data.amount,
                        utr: utr
                    }
                });
            }
        } catch (e) {
            // Upstream check failed or returned error
        }

        return res.status(404).json({ code: 0, msg: 'Transaction not found' });
    } catch (error) {
        console.error('Check UTR error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payin/callback
 */
router.post('/callback', async (req, res) => {
    try {
        console.log('Pay-in callback received:', req.body);
        const { status, amount, payOrderId, mId, mOrderId, sign, utr } = req.body;
        const db = getDb();

        await db.prepare(`INSERT INTO callback_logs (type, request_body, status) VALUES ('payin', ?, ?)`).run(JSON.stringify(req.body), status);

        // Verify Signature
        if (!silkpayService.verifyPayinCallback(req.body)) {
            console.error('Payin callback signature verification failed');
            return res.send('OK'); // Return OK to stop retries even if bad sign? Usually yes to avoid spam.
        }

        // Lookup transaction by payOrderId (platform_order_id)
        // Silkpay returns payOrderId. We stored it in platform_order_id.
        const tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ?')
            .get(payOrderId);

        if (!tx) {
            console.log('Transaction not found for payOrderId:', payOrderId);
            return res.send('OK');
        }

        const newStatus = status === '1' || status === 1 ? 'success' : 'failed';
        const actualAmount = parseFloat(amount);
        const rates = await getRatesFromDb(db);
        const { fee, netAmount } = calculatePayinFee(actualAmount, rates.payinRate);

        await db.prepare(`UPDATE transactions SET status = ?, amount = ?, fee = ?, net_amount = ?, utr = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, actualAmount, fee, netAmount, utr || null, JSON.stringify(req.body), tx.id);

        if (newStatus === 'success' && tx.status !== 'success') {
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);
        }

        // Unwrap stored param
        let callbackUrl = null;
        let originalParam = null;
        try {
            if (tx.param) {
                const parsed = JSON.parse(tx.param);
                // Check if it's our wrapper structure
                if (parsed.c !== undefined || parsed.p !== undefined) {
                    callbackUrl = parsed.c;
                    originalParam = parsed.p;
                } else {
                    // Legacy or plain string? If it's json but not our structure, treat as original?
                    // Safe bet: if parsing works, use it, but our wrapper is strictly {c, p}
                    originalParam = tx.param;
                }
            }
        } catch (e) {
            // Not JSON, assume string param
            originalParam = tx.param;
        }

        const merchantCallback = callbackUrl || tx.callback_url;
        if (merchantCallback) {
            try {
                const merchantCallbackData = {
                    status: newStatus === 'success' ? 1 : 0,
                    amount: netAmount, orderAmount: actualAmount,
                    orderId: tx.order_id, // User's order ID
                    id: tx.uuid, utr: utr || '', param: originalParam || ''
                };
                merchantCallbackData.sign = generateSign(merchantCallbackData, tx.merchant_key);
                await axios.post(merchantCallback, merchantCallbackData, { timeout: 10000 });
            } catch (callbackError) {
                console.error('Failed to forward callback:', callbackError.message);
            }
        }

        res.send('OK');
    } catch (error) {
        console.error('Payin callback error:', error);
        res.send('OK');
    }
});

module.exports = router;
