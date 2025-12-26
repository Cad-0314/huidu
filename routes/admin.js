const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateMerchantKey } = require('../utils/signature');
const telegramService = require('../services/telegram');

/**
 * GET /api/admin/users
 * Get all merchants
 */
/**
 * GET /api/admin/users
 * Get all merchants
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();
        console.log(`[ADMIN] Fetching users. Page: ${page}, Limit: ${limit}, Search: ${search}`);

        // Base Query
        let query = `
            SELECT id, uuid, username, name, role, balance, status, callback_url, merchant_key, payin_rate, payout_rate, usdt_rate, two_factor_enabled, channel, created_at
            FROM users
            WHERE role != 'admin'
        `;
        const params = [];

        if (search) {
            query += ' AND (username LIKE ? OR name LIKE ? OR uuid LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        if (req.query.status) {
            query += ' AND status = ?';
            params.push(req.query.status);
        }


        if (req.query.startDate && req.query.endDate) {
            query += ' AND date(created_at) BETWEEN ? AND ?';
            params.push(req.query.startDate, req.query.endDate);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const users = await db.prepare(query).all(...params);

        // Count Query
        let countQuery = "SELECT COUNT(*) as total FROM users WHERE role != 'admin'";
        const countParams = [];
        if (search) {
            countQuery += ' AND (username LIKE ? OR name LIKE ? OR uuid LIKE ?)';
            const term = `%${search}%`;
            countParams.push(term, term, term);
        }
        if (req.query.startDate && req.query.endDate) {
            countQuery += ' AND date(created_at) BETWEEN ? AND ?';
            countParams.push(req.query.startDate, req.query.endDate);
        }

        const total = (await db.prepare(countQuery).get(...countParams)).total;

        res.json({
            code: 1,
            data: {
                users: users.map(u => ({
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
                    usdtRate: u.usdt_rate,
                    twoFactorEnabled: !!u.two_factor_enabled,
                    channel: u.channel || 'silkpay',
                    createdAt: u.created_at
                })),
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
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
        const { username, password, name, callbackUrl, payinRate, payoutRate, usdtRate, channel } = req.body;
        const db = getDb();

        if (!username || !password || !name) {
            return res.status(400).json({ code: 0, msg: 'Username, password, and name are required' });
        }

        // Validate Rates
        const pRate = parseFloat(payinRate || 5.0);
        const poRate = parseFloat(payoutRate || 3.0);
        const uRate = parseFloat(usdtRate || 100.0); // Default USDT Rate

        if (pRate < 0) return res.status(400).json({ code: 0, msg: 'Invalid Pay-in rate' });
        if (poRate < 0) return res.status(400).json({ code: 0, msg: 'Invalid Payout rate' });

        const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Username already exists' });
        }

        const uuid = crypto.randomBytes(4).toString('hex');
        const hashedPassword = bcrypt.hashSync(password, 10);
        const merchantKey = generateMerchantKey();

        // Validate channel
        const validChannels = ['silkpay', 'f2pay', 'gtpay', 'hdpay'];
        const userChannel = validChannels.includes(channel) ? channel : 'silkpay';

        const result = await db.prepare(`
            INSERT INTO users(uuid, username, password, name, role, merchant_key, callback_url, payin_rate, payout_rate, usdt_rate, channel)
            VALUES(?, ?, ?, ?, 'merchant', ?, ?, ?, ?, ?, ?)
                `).run(uuid, username, hashedPassword, name, merchantKey, callbackUrl || null, pRate, poRate, uRate, userChannel);

        res.json({
            code: 1,
            msg: 'Merchant created successfully',
            data: { id: result.lastInsertRowid.toString(), username, name, password, merchantKey, callbackUrl, payinRate: pRate, payoutRate: poRate, usdtRate: uRate, channel: userChannel }
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/admin/users/:id
 * Get single merchant details
 */
router.get('/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();
        const user = await db.prepare(`
            SELECT id, uuid, username, name, role, balance, status, callback_url, merchant_key, payin_rate, payout_rate, usdt_rate, two_factor_enabled, channel, created_at
            FROM users
            WHERE uuid = ? OR id = ?
        `).get(id, id);

        if (!user) {
            return res.status(404).json({ code: 0, msg: 'User not found' });
        }

        res.json({
            code: 1,
            data: {
                id: user.uuid,
                dbId: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                balance: user.balance,
                status: user.status,
                callbackUrl: user.callback_url,
                merchantKey: user.merchant_key,
                payinRate: user.payin_rate,
                payoutRate: user.payout_rate,
                usdtRate: user.usdt_rate,
                twoFactorEnabled: !!user.two_factor_enabled,
                channel: user.channel || 'silkpay',
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * PUT /api/admin/users/:id
 */
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, status, callbackUrl, payinRate, payoutRate, usdtRate, channel } = req.body;
        const db = getDb();

        // Validate channel if provided
        const validChannels = ['silkpay', 'f2pay', 'gtpay', 'hdpay'];
        const userChannel = channel && validChannels.includes(channel) ? channel : undefined;

        if (userChannel) {
            await db.prepare(`
                UPDATE users 
                SET name = ?, status = ?, callback_url = ?, payin_rate = ?, payout_rate = ?, usdt_rate = ?, channel = ?, updated_at = datetime('now')
                WHERE uuid = ?
            `).run(name, status, callbackUrl, parseFloat(payinRate), parseFloat(payoutRate), parseFloat(usdtRate || 0), userChannel, id);
        } else {
            await db.prepare(`
                UPDATE users 
                SET name = ?, status = ?, callback_url = ?, payin_rate = ?, payout_rate = ?, usdt_rate = ?, updated_at = datetime('now')
                WHERE uuid = ?
            `).run(name, status, callbackUrl, parseFloat(payinRate), parseFloat(payoutRate), parseFloat(usdtRate || 0), id);
        }

        res.json({ code: 1, msg: 'User updated' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/broadcast
 */
router.post('/broadcast', authenticate, requireAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ code: 0, msg: 'Message is required' });

        const result = await telegramService.broadcastMessage(message);
        res.json({ code: 1, msg: 'Broadcast sent', data: result });
    } catch (error) {
        console.error('Broadcast error:', error);
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
            WHERE p.status = 'pending'
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
                payoutType: p.payout_type,
                walletAddress: p.wallet_address,
                network: p.network,
                accountNumber: p.account_number,
                ifsc: p.ifsc,
                personName: p.person_name,
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

        // Calculate Profit (Total Fees - Cost)
        // Cost = Payin Amount * admin_payin_cost (default 0.05)
        const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
        const adminCostRate = settings ? parseFloat(settings.value) : 0.05;

        const totalPayinAmt = totalPayins.total || 0;
        const totalAllFees = (totalFees.total || 0) + (payoutFees.total || 0);

        // Profit = Total Fees Collected - (Payin Amount * Cost Rate)
        // Note: Payout cost is usually fixed or negligible/internal, user focused on payin margin. 
        // If user wants payout profit too, it's (Payout Fees - Payout Cost). 
        // For now, assuming "User Request: suppose some merchent payin is 9.3 but admin rate is 5%..." implies Payin focus.
        const totalProfit = totalAllFees - (totalPayinAmt * adminCostRate);

        // Calculate Total Merchant Balance (Liability)
        const merchantBal = await db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM users WHERE role != ?').get('admin');
        const totalMerchantBalance = merchantBal.total;

        res.json({
            code: 1,
            data: {
                totalUsers,
                totalPayins: totalPayins.count || 0,
                totalPayinAmount: totalPayinAmt,
                totalPayouts: totalPayouts.count || 0,
                totalPayoutAmount: totalPayouts.total || 0,
                pendingPayouts,
                totalFees: totalAllFees,
                totalProfit: totalProfit,
                totalMerchantBalance: totalMerchantBalance
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
        const { page = 1, limit = 20, type, status, search, startDate, endDate } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();

        let query = `
            SELECT t.*, u.username, u.name as merchant_name
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE 1 = 1
            `;
        const params = [];

        if (startDate) {
            query += ' AND t.created_at >= ?';
            params.push(startDate + ' 00:00:00');
        }

        if (endDate) {
            query += ' AND t.created_at <= ?';
            params.push(endDate + ' 23:59:59');
        }

        if (type) { query += ' AND t.type = ?'; params.push(type); }
        if (status) { query += ' AND t.status = ?'; params.push(status); }

        if (search) {
            query += ' AND (t.order_id LIKE ? OR u.username LIKE ? OR t.utr LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

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

        // Update merchant balance
        await db.prepare('UPDATE users SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(newBalance, user.id);

        // Update admin balance (Zero-sum: Deduct adjustment from admin)
        // If we add to merchant (positive amount), we deduct from admin.
        // If we deduct from merchant (negative amount), we add to admin.
        await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
            .run(adjustAmount, req.user.id);

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

/**
 * POST /api/admin/users/:id/2fa/reset
 */
// Reset 2FA with UUID support
router.post('/users/:id/2fa/reset', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const result = await db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE uuid = ? OR id = ?').run(id, id);

        if (result.changes === 0) {
            return res.status(404).json({ code: 0, msg: 'User not found' });
        }

        res.json({ code: 1, msg: 'User 2FA Reset Successfully' });
    } catch (error) {
        console.error('Reset 2FA error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/admin/users/:id/password
 * Admin Reset User Password
 */
router.post('/users/:id/password', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!password) return res.status(400).json({ code: 0, msg: 'Password required' });

        const db = getDb();
        const hashedPassword = bcrypt.hashSync(password, 10);

        const result = await db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE uuid = ? OR id = ?")
            .run(hashedPassword, id, id);

        if (result.changes === 0) {
            return res.status(404).json({ code: 0, msg: 'User not found' });
        }

        res.json({ code: 1, msg: 'Password reset successfully' });
    } catch (error) {
        console.error('Admin reset password error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

module.exports = router;

module.exports = router;
