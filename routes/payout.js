const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const payableService = require('../services/payable');
const { calculatePayoutFee, getRatesFromDb } = require('../utils/rates');
const { generateOrderId, generateSign } = require('../utils/signature');

/**
 * POST /api/payout/bank - Bank payout (automatic)
 */
router.post('/bank', apiAuthenticate, async (req, res) => {
    try {
        const { amount, orderId, account, ifsc, personName, callbackUrl, param } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!amount || !orderId || !account || !ifsc || !personName) {
            return res.status(400).json({ code: 0, msg: 'amount, orderId, account, ifsc, and personName are required' });
        }

        const payoutAmount = parseFloat(amount);

        // Minimum bank withdraw: ₹100
        if (payoutAmount < 100) {
            return res.status(400).json({ code: 0, msg: 'Minimum bank withdrawal is ₹100' });
        }

        const existing = db.prepare('SELECT id FROM payouts WHERE order_id = ?').get(orderId);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Order ID already exists' });
        }

        const payoutAmount = parseFloat(amount);
        const rates = getRatesFromDb(db);
        const { fee, totalDeduction } = calculatePayoutFee(payoutAmount, rates.payoutRate, rates.payoutFixed);

        if (merchant.balance < totalDeduction) {
            return res.status(400).json({ code: 0, msg: `Insufficient balance. Required: ${totalDeduction}, Available: ${merchant.balance}` });
        }

        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalDeduction, merchant.id);

        const internalOrderId = generateOrderId('HDO');
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const ourCallbackUrl = `${appUrl}/api/payout/callback`;

        const callbackParam = JSON.stringify({
            merchantId: merchant.uuid, merchantOrderId: orderId,
            merchantCallback: callbackUrl || merchant.callback_url, originalParam: param
        });

        const payoutUuid = uuidv4();
        db.prepare(`INSERT INTO payouts (uuid, user_id, order_id, platform_order_id, payout_type, amount, fee, net_amount, status, account_number, ifsc_code, account_name) VALUES (?, ?, ?, ?, 'bank', ?, ?, ?, 'processing', ?, ?, ?)`)
            .run(payoutUuid, merchant.id, orderId, internalOrderId, payoutAmount, fee, payoutAmount, account, ifsc, personName);

        try {
            const payableResponse = await payableService.createPayout({
                amount, orderId: internalOrderId, account, ifsc, personName,
                callbackUrl: ourCallbackUrl, param: callbackParam
            });

            if (payableResponse.code !== 1) {
                db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalDeduction, merchant.id);
                db.prepare('UPDATE payouts SET status = ?, message = ? WHERE uuid = ?').run('failed', payableResponse.msg || 'Payable API error', payoutUuid);
                return res.status(400).json({ code: 0, msg: payableResponse.msg || 'Failed to create payout' });
            }

            db.prepare('UPDATE payouts SET platform_order_id = ? WHERE uuid = ?').run(payableResponse.data?.id || internalOrderId, payoutUuid);
            res.json({ code: 1, msg: 'Payout submitted', data: { orderId, id: payoutUuid, amount: payoutAmount, fee, status: 'processing' } });
        } catch (apiError) {
            db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalDeduction, merchant.id);
            db.prepare('UPDATE payouts SET status = ?, message = ? WHERE uuid = ?').run('failed', apiError.message, payoutUuid);
            throw apiError;
        }
    } catch (error) {
        console.error('Create bank payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payout/usdt - USDT payout (manual approval)
 */
router.post('/usdt', apiAuthenticate, async (req, res) => {
    try {
        const { amount, orderId, walletAddress, network, callbackUrl, param } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!amount || !orderId || !walletAddress || !network) {
            return res.status(400).json({ code: 0, msg: 'amount, orderId, walletAddress, and network are required' });
        }

        const payoutAmount = parseFloat(amount);

        // Minimum USDT withdraw: 500 USDT = ₹51,500 (at 103 INR/USDT)
        const minUsdtInr = 500 * 103; // 500 USDT × 103 = ₹51,500
        if (payoutAmount < minUsdtInr) {
            return res.status(400).json({ code: 0, msg: `Minimum USDT withdrawal is 500 USDT (₹${minUsdtInr.toLocaleString()})` });
        }

        if (!['TRC20', 'ERC20', 'BEP20'].includes(network)) {
            return res.status(400).json({ code: 0, msg: 'Invalid network. Use TRC20, ERC20, or BEP20' });
        }

        const existing = db.prepare('SELECT id FROM payouts WHERE order_id = ?').get(orderId);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Order ID already exists' });
        }

        const payoutAmount = parseFloat(amount);
        const rates = getRatesFromDb(db);
        const { fee, totalDeduction } = calculatePayoutFee(payoutAmount, rates.payoutRate, rates.payoutFixed);

        if (merchant.balance < totalDeduction) {
            return res.status(400).json({ code: 0, msg: `Insufficient balance. Required: ${totalDeduction}, Available: ${merchant.balance}` });
        }

        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalDeduction, merchant.id);

        const payoutUuid = uuidv4();
        db.prepare(`INSERT INTO payouts (uuid, user_id, order_id, payout_type, amount, fee, net_amount, status, wallet_address, network) VALUES (?, ?, ?, 'usdt', ?, ?, ?, 'pending', ?, ?)`)
            .run(payoutUuid, merchant.id, orderId, payoutAmount, fee, payoutAmount, walletAddress, network);

        res.json({ code: 1, msg: 'USDT payout submitted, awaiting admin approval', data: { orderId, id: payoutUuid, amount: payoutAmount, fee, status: 'pending' } });
    } catch (error) {
        console.error('Create USDT payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payout/query
 */
router.post('/query', apiAuthenticate, async (req, res) => {
    try {
        const { orderId } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!orderId) {
            return res.status(400).json({ code: 0, msg: 'orderId is required' });
        }

        const payout = db.prepare('SELECT * FROM payouts WHERE order_id = ? AND user_id = ?').get(orderId, merchant.id);

        if (!payout) {
            return res.status(404).json({ code: 0, msg: 'Payout not found' });
        }

        res.json({
            code: 1,
            data: {
                orderId: payout.order_id, id: payout.uuid, type: payout.payout_type,
                status: payout.status, amount: payout.amount, fee: payout.fee,
                netAmount: payout.net_amount, utr: payout.utr, message: payout.message, createdAt: payout.created_at
            }
        });
    } catch (error) {
        console.error('Query payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payout/callback
 */
router.post('/callback', async (req, res) => {
    try {
        console.log('Payout callback received:', req.body);
        const { status, amount, commission, message, orderId, id, utr, sign, param } = req.body;
        const db = getDb();

        db.prepare(`INSERT INTO callback_logs (type, request_body, status) VALUES ('payout', ?, ?)`).run(JSON.stringify(req.body), status);

        let callbackData;
        try { callbackData = JSON.parse(param || '{}'); } catch (e) { callbackData = {}; }

        const payout = db.prepare('SELECT p.*, u.callback_url, u.merchant_key FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ? OR p.order_id = ?')
            .get(orderId, callbackData.merchantOrderId);

        if (!payout) {
            console.log('Payout not found for orderId:', orderId);
            return res.send('success');
        }

        const newStatus = status === '1' || status === 1 ? 'success' : 'failed';

        db.prepare(`UPDATE payouts SET status = ?, utr = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, utr || null, message || null, JSON.stringify(req.body), payout.id);

        if (newStatus === 'failed') {
            db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.amount + payout.fee, payout.user_id);
        }

        const merchantCallback = callbackData.merchantCallback || payout.callback_url;
        if (merchantCallback) {
            try {
                const merchantCallbackData = {
                    status: newStatus === 'success' ? 1 : 2, amount: payout.amount, commission: payout.fee,
                    message: message || (newStatus === 'success' ? 'success' : 'failed'),
                    orderId: callbackData.merchantOrderId || payout.order_id,
                    id: payout.uuid, utr: utr || '', param: callbackData.originalParam
                };
                merchantCallbackData.sign = generateSign(merchantCallbackData, payout.merchant_key);
                await axios.post(merchantCallback, merchantCallbackData, { timeout: 10000 });
            } catch (callbackError) {
                console.error('Failed to forward callback:', callbackError.message);
            }
        }

        res.send('success');
    } catch (error) {
        console.error('Payout callback error:', error);
        res.send('success');
    }
});

module.exports = router;
