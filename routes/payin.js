const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const payableService = require('../services/payable');
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

        const callbackParam = JSON.stringify({
            merchantId: merchant.uuid,
            merchantOrderId: orderId,
            merchantCallback: callbackUrl || merchant.callback_url,
            originalParam: param
        });

        const payableResponse = await payableService.createPayin({
            orderAmount: orderAmount,
            orderId: internalOrderId,
            callbackUrl: ourCallbackUrl,
            skipUrl: ourSkipUrl,
            param: callbackParam
        });

        if (payableResponse.code !== 1) {
            return res.status(400).json({ code: 0, msg: payableResponse.msg || 'Failed to create order' });
        }

        const txUuid = uuidv4();
        await db.prepare(`
            INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param)
            VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(txUuid, merchant.id, orderId, payableResponse.data?.id || internalOrderId, amount, amount, fee, netAmount, payableResponse.data?.rechargeUrl || null, param || null);

        res.json({
            code: 1,
            msg: 'Order created',
            data: { orderId, id: txUuid, orderAmount: amount, fee, rechargeUrl: payableResponse.data?.rechargeUrl }
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
 * POST /api/payin/callback
 */
router.post('/callback', async (req, res) => {
    try {
        console.log('Pay-in callback received:', req.body);
        const { status, amount, orderAmount, orderId, id, sign, param, utr } = req.body;
        const db = getDb();

        await db.prepare(`INSERT INTO callback_logs (type, request_body, status) VALUES ('payin', ?, ?)`).run(JSON.stringify(req.body), status);

        let callbackData;
        try { callbackData = JSON.parse(param || '{}'); } catch (e) { callbackData = {}; }

        const tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ? OR t.order_id = ?')
            .get(orderId, callbackData.merchantOrderId);

        if (!tx) {
            console.log('Transaction not found for orderId:', orderId);
            return res.send('success');
        }

        const newStatus = status === '1' || status === 1 ? 'success' : 'failed';
        const actualAmount = parseFloat(amount);
        const rates = await getRatesFromDb(db);
        const { fee, netAmount } = calculatePayinFee(actualAmount, rates.payinRate);

        await db.prepare(`UPDATE transactions SET status = ?, amount = ?, fee = ?, net_amount = ?, utr = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, actualAmount, fee, netAmount, utr || null, JSON.stringify(req.body), tx.id);

        if (newStatus === 'success') {
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);
        }

        const merchantCallback = callbackData.merchantCallback || tx.callback_url;
        if (merchantCallback) {
            try {
                const merchantCallbackData = {
                    status: newStatus === 'success' ? 1 : 0,
                    amount: netAmount, orderAmount: actualAmount,
                    orderId: callbackData.merchantOrderId || tx.order_id,
                    id: tx.uuid, utr: utr || '', param: callbackData.originalParam
                };
                merchantCallbackData.sign = generateSign(merchantCallbackData, tx.merchant_key);
                await axios.post(merchantCallback, merchantCallbackData, { timeout: 10000 });
            } catch (callbackError) {
                console.error('Failed to forward callback:', callbackError.message);
            }
        }

        res.send('success');
    } catch (error) {
        console.error('Payin callback error:', error);
        res.send('success');
    }
});

module.exports = router;
