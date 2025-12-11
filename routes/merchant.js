const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/merchant/balance
 */
router.get('/balance', authenticate, (req, res) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);

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
router.get('/transactions', authenticate, (req, res) => {
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

        const transactions = db.prepare(query).all(...params);
        const total = db.prepare('SELECT COUNT(*) as total FROM transactions WHERE user_id = ?').get(req.user.id).total;

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
router.get('/payouts', authenticate, (req, res) => {
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

        const payouts = db.prepare(query).all(...params);

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
router.get('/stats', authenticate, (req, res) => {
    try {
        const userId = req.user.id;
        const db = getDb();

        const payinStats = db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total, COALESCE(SUM(fee), 0) as fees
            FROM transactions WHERE user_id = ? AND status = 'success'
        `).get(userId);

        const payoutStats = db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total, COALESCE(SUM(fee), 0) as fees
            FROM payouts WHERE user_id = ? AND status = 'success'
        `).get(userId);

        const pendingPayouts = db.prepare(`
            SELECT COUNT(*) as count FROM payouts WHERE user_id = ? AND status = 'pending'
        `).get(userId).count;

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

module.exports = router;
