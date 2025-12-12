const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateMerchantKey } = require('../utils/signature');

/**
 * GET /api/admin/users
 * Get all merchants
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const users = await db.prepare(`
            SELECT id, uuid, username, name, role, balance, status, callback_url, merchant_key, payin_rate, payout_rate, created_at
            FROM users
            ORDER BY created_at DESC
        `).all();

        res.json({
            code: 1,
            data: users.map(u => ({
                id: u.uuid,
                username: u.username,
                name: u.name,
                role: u.role,
                balance: u.balance,
                status: u.status,
                callbackUrl: u.callback_url,
                merchantKey: u.merchant_key,
                payinRate: u.payin_rate,
                payoutRate: u.payout_rate,
                createdAt: u.created_at
            }))
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/users
 * Create new merchant
 */
router.post('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const { username, password, name, callbackUrl, payinRate, payoutRate } = req.body;
        const db = getDb();

        if (!username || !password || !name) {
            return res.status(400).json({ code: 0, msg: 'Username, password, and name are required' });
        }

        // Validate Rates
        const pRate = parseFloat(payinRate || 5.0);
        const poRate = parseFloat(payoutRate || 3.0);

        if (pRate < 5) {
            return res.status(400).json({ code: 0, msg: 'Pay-in rate must be 5% or more' });
        }
        if (poRate < 3) {
            return res.status(400).json({ code: 0, msg: 'Payout rate must be 3% or more' });
        }

        const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Username already exists' });
        }

        const uuid = crypto.randomBytes(4).toString('hex');
        const hashedPassword = bcrypt.hashSync(password, 10);
        const merchantKey = generateMerchantKey();

        await db.prepare(`
            INSERT INTO users(uuid, username, password, name, role, merchant_key, callback_url, payin_rate, payout_rate)
            VALUES(?, ?, ?, ?, 'merchant', ?, ?, ?, ?)
                `).run(uuid, username, hashedPassword, name, merchantKey, callbackUrl || null, pRate, poRate);

        res.json({
            code: 1,
            msg: 'Merchant created successfully',
            data: { id: uuid, username, name, merchantKey, callbackUrl, payinRate: pRate, payoutRate: poRate }
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * PUT /api/admin/users/:id
 */
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, status, callbackUrl, payinRate, payoutRate } = req.body;
        const db = getDb();

        const user = await db.prepare('SELECT * FROM users WHERE uuid = ?').get(id);
        if (!user) {
            return res.status(404).json({ code: 0, msg: 'User not found' });
        }

        const updates = [];
        const params = [];

        if (name) { updates.push('name = ?'); params.push(name); }
        if (status) { updates.push('status = ?'); params.push(status); }
        if (callbackUrl !== undefined) { updates.push('callback_url = ?'); params.push(callbackUrl); }

        if (payinRate !== undefined) {
            const pRate = parseFloat(payinRate);
            if (pRate < 5) return res.status(400).json({ code: 0, msg: 'Pay-in rate must be 5% or more' });
            updates.push('payin_rate = ?');
            params.push(pRate);
        }

        if (payoutRate !== undefined) {
            const poRate = parseFloat(payoutRate);
            if (poRate < 3) return res.status(400).json({ code: 0, msg: 'Payout rate must be 3% or more' });
            updates.push('payout_rate = ?');
            params.push(poRate);
        }

        if (updates.length > 0) {
            updates.push("updated_at = datetime('now')");
            params.push(user.id);
            await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ? `).run(...params);
        }

        res.json({ code: 1, msg: 'User updated' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/admin/payouts/pending
 */
router.get('/payouts/pending', authenticate, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const payouts = await db.prepare(`
            SELECT p.*, u.username, u.name as merchant_name
            FROM payouts p
            JOIN users u ON p.user_id = u.id
            WHERE p.payout_type = 'usdt' AND p.status = 'pending'
            ORDER BY p.created_at ASC
            `).all();

        res.json({
            code: 1,
            data: payouts.map(p => ({
                id: p.uuid,
                orderId: p.order_id,
                merchantUsername: p.username,
                merchantName: p.merchant_name,
                amount: p.amount,
                fee: p.fee,
                netAmount: p.net_amount,
                walletAddress: p.wallet_address,
                network: p.network,
                status: p.status,
                createdAt: p.created_at
            }))
        });
    } catch (error) {
        console.error('Get pending payouts error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/payouts/:id/approve
 */
router.post('/payouts/:id/approve', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { utr } = req.body;
        const db = getDb();

        const payout = await db.prepare('SELECT * FROM payouts WHERE uuid = ? AND status = ?').get(id, 'pending');
        if (!payout) {
            return res.status(404).json({ code: 0, msg: 'Payout not found or already processed' });
        }

        // Admin gets the payout amount added to their balance
        // Find admin user (or use current user if they are admin, which they must be)
        await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.amount, req.user.id);

        await db.prepare(`
            UPDATE payouts 
            SET status = 'success', approved_by = ?, approved_at = datetime('now'), utr = ?, updated_at = datetime('now')
            WHERE id = ?
            `).run(req.user.id, utr || null, payout.id);

        res.json({ code: 1, msg: 'Payout approved' });
    } catch (error) {
        console.error('Approve payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/payouts/:id/reject
 */
router.post('/payouts/:id/reject', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const db = getDb();

        const payout = await db.prepare('SELECT * FROM payouts WHERE uuid = ? AND status = ?').get(id, 'pending');
        if (!payout) {
            return res.status(404).json({ code: 0, msg: 'Payout not found or already processed' });
        }

        // Refund balance
        await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
            .run(payout.amount + payout.fee, payout.user_id);

        await db.prepare(`
            UPDATE payouts 
            SET status = 'rejected', approved_by = ?, approved_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now')
            WHERE id = ?
            `).run(req.user.id, reason || 'Rejected by admin', payout.id);

        res.json({ code: 1, msg: 'Payout rejected and balance refunded' });
    } catch (error) {
        console.error('Reject payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/admin/stats
 */
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const totalUsers = (await db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('merchant')).count;
        const totalPayins = (await db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = ? AND status = ?').get('payin', 'success'));
        const totalPayouts = (await db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payouts WHERE status = ?').get('success'));
        const pendingPayouts = (await db.prepare('SELECT COUNT(*) as count FROM payouts WHERE status = ? AND payout_type = ?').get('pending', 'usdt')).count;
        const totalFees = (await db.prepare('SELECT COALESCE(SUM(fee), 0) as total FROM transactions WHERE status = ?').get('success'));
        const payoutFees = (await db.prepare('SELECT COALESCE(SUM(fee), 0) as total FROM payouts WHERE status = ?').get('success'));

        res.json({
            code: 1,
            data: {
                totalUsers,
                totalPayins: totalPayins.count || 0,
                totalPayinAmount: totalPayins.total || 0,
                totalPayouts: totalPayouts.count || 0,
                totalPayoutAmount: totalPayouts.total || 0,
                pendingPayouts,
                totalFees: (totalFees.total || 0) + (payoutFees.total || 0)
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/admin/transactions
 */
router.get('/transactions', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();

        let query = `
            SELECT t.*, u.username, u.name as merchant_name
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE 1 = 1
            `;
        const params = [];

        if (type) { query += ' AND t.type = ?'; params.push(type); }
        if (status) { query += ' AND t.status = ?'; params.push(status); }

        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const transactions = await db.prepare(query).all(...params);

        res.json({
            code: 1,
            data: transactions.map(t => ({
                id: t.uuid,
                orderId: t.order_id,
                platformOrderId: t.platform_order_id,
                merchantUsername: t.username,
                merchantName: t.merchant_name,
                type: t.type,
                amount: t.amount,
                fee: t.fee,
                netAmount: t.net_amount,
                status: t.status,
                utr: t.utr,
                createdAt: t.created_at
            }))
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/users/:id/balance
 * Adjust merchant balance (add or deduct)
 */
router.post('/users/:id/balance', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;
        const db = getDb();

        if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
            return res.status(400).json({ code: 0, msg: 'Valid amount is required' });
        }

        const adjustAmount = parseFloat(amount);

        const user = await db.prepare('SELECT * FROM users WHERE uuid = ?').get(id);
        if (!user) {
            return res.status(404).json({ code: 0, msg: 'User not found' });
        }

        if (user.role === 'admin') {
            return res.status(400).json({ code: 0, msg: 'Cannot adjust admin balance' });
        }

        const newBalance = user.balance + adjustAmount;
        if (newBalance < 0) {
            return res.status(400).json({ code: 0, msg: `Insufficient balance.Current: ${user.balance}, Adjustment: ${adjustAmount}` });
        }

        // Update balance
        await db.prepare('UPDATE users SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(newBalance, user.id);

        // Log the adjustment
        const logEntry = {
            timestamp: new Date().toISOString(),
            adminId: req.user.uuid,
            adminUsername: req.user.username,
            merchantId: user.uuid,
            merchantUsername: user.username,
            previousBalance: user.balance,
            adjustment: adjustAmount,
            newBalance: newBalance,
            reason: reason || 'Manual adjustment by admin'
        };
        console.log('BALANCE ADJUSTMENT:', JSON.stringify(logEntry));

        res.json({
            code: 1,
            msg: adjustAmount >= 0 ? 'Balance added successfully' : 'Balance deducted successfully',
            data: {
                previousBalance: user.balance,
                adjustment: adjustAmount,
                newBalance: newBalance
            }
        });
    } catch (error) {
        console.error('Adjust balance error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

module.exports = router;
