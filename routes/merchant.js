const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const payableService = require('../services/payable');
const { calculatePayinFee, getRatesFromDb } = require('../utils/rates');
const { generateOrderId } = require('../utils/signature');

/**
 * GET /api/merchant/balance
 */
router.get('/balance', authenticate, async (req, res) => {
    try {
        const db = getDb();
        const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);

        res.json({
            code: 1,
            data: {
                balance: user.balance,
                userId: req.user.uuid,
                platDate: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/transactions
 */
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();

        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND type = ?'; params.push(type); }
        if (status) { query += ' AND status = ?'; params.push(status); }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const transactions = await db.prepare(query).all(...params);
        const total = (await db.prepare('SELECT COUNT(*) as total FROM transactions WHERE user_id = ?').get(req.user.id)).total;

        res.json({
            code: 1,
            data: {
                transactions: transactions.map(t => ({
                    id: t.uuid,
                    orderId: t.order_id,
                    type: t.type,
                    amount: t.amount,
                    fee: t.fee,
                    netAmount: t.net_amount,
                    status: t.status,
                    utr: t.utr,
                    createdAt: t.created_at
                })),
                total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/payouts
 */
router.get('/payouts', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();

        let query = 'SELECT * FROM payouts WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND payout_type = ?'; params.push(type); }
        if (status) { query += ' AND status = ?'; params.push(status); }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const payouts = await db.prepare(query).all(...params);

        res.json({
            code: 1,
            data: payouts.map(p => ({
                id: p.uuid,
                orderId: p.order_id,
                type: p.payout_type,
                amount: p.amount,
                fee: p.fee,
                status: p.status,
                utr: p.utr,
                message: p.message,
                walletAddress: p.wallet_address,
                network: p.network,
                accountNumber: p.account_number,
                ifscCode: p.ifsc_code,
                accountName: p.account_name,
                createdAt: p.created_at
            }))
        });
    } catch (error) {
        console.error('Get payouts error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/stats
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const db = getDb();

        const payinStats = await db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total, COALESCE(SUM(fee), 0) as fees
            FROM transactions WHERE user_id = ? AND status = 'success'
        `).get(userId);

        const payoutStats = await db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total, COALESCE(SUM(fee), 0) as fees
            FROM payouts WHERE user_id = ? AND status = 'success'
        `).get(userId);

        const pendingPayouts = (await db.prepare(`
            SELECT COUNT(*) as count FROM payouts WHERE user_id = ? AND status = 'pending'
        `).get(userId)).count;

        res.json({
            code: 1,
            data: {
                balance: req.user.balance,
                payin: { count: payinStats.count, total: payinStats.total, fees: payinStats.fees },
                payout: { count: payoutStats.count, total: payoutStats.total, fees: payoutStats.fees },
                pendingPayouts
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/credentials
 */
router.get('/credentials', authenticate, (req, res) => {
    try {
        res.json({
            code: 1,
            data: {
                userId: req.user.uuid,
                merchantKey: req.user.merchant_key,
                callbackUrl: req.user.callback_url
            }
        });
    } catch (error) {
        console.error('Get credentials error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/merchant/payin/create
 * Session-authenticated endpoint for dashboard to create payment links
 * Uses JWT auth instead of API signature
 */
router.post('/payin/create', authenticate, async (req, res) => {
    try {
        const { orderAmount, orderId, callbackUrl, skipUrl, param } = req.body;
        const merchant = req.user; // From JWT auth
        const db = getDb();

        console.log('[MERCHANT PAYIN] Request:', { orderAmount, orderId, userId: merchant.uuid });

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

        console.log('[MERCHANT PAYIN] Calling Payable API...');

        const payableResponse = await payableService.createPayin({
            orderAmount: orderAmount,
            orderId: internalOrderId,
            callbackUrl: ourCallbackUrl,
            skipUrl: ourSkipUrl,
            param: callbackParam
        });

        console.log('[MERCHANT PAYIN] Payable API Response:', JSON.stringify(payableResponse));

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
        console.error('[MERCHANT PAYIN] Error:', error);
        res.status(500).json({ code: 0, msg: 'Server error: ' + error.message });
    }
});

module.exports = router;
