const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const silkpayService = require('../services/silkpay');
const { calculatePayinFee, getRatesFromDb } = require('../utils/rates');
const { generateOrderId } = require('../utils/signature');
const { createPayinOrder } = require('../services/order');

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
/**
 * GET /api/merchant/transactions
 */
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status, search } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();
        console.log(`[TX] Fetching transactions. User: ${req.user.id}, Page: ${page}, Limit: ${limit}, Search: ${search}`);

        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND type = ?'; params.push(type); }
        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (order_id LIKE ? OR platform_order_id LIKE ? OR utr LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        if (req.query.startDate && req.query.endDate) {
            query += ' AND date(created_at) BETWEEN ? AND ?';
            params.push(req.query.startDate, req.query.endDate);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        console.log('[TX DEBUG] Query:', query);
        console.log('[TX DEBUG] Params:', params);

        const transactions = await db.prepare(query).all(...params);

        // Count query must match filters
        let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?';
        const countParams = [req.user.id];
        if (type) { countQuery += ' AND type = ?'; countParams.push(type); }
        if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
        if (search) {
            countQuery += ' AND (order_id LIKE ? OR platform_order_id LIKE ? OR utr LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
        }
        if (req.query.startDate && req.query.endDate) {
            countQuery += ' AND date(created_at) BETWEEN ? AND ?';
            countParams.push(req.query.startDate, req.query.endDate);
        }

        const total = (await db.prepare(countQuery).get(...countParams)).total;

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
                    createdAt: t.created_at,
                    updatedAt: t.updated_at
                })),
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
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
/**
 * GET /api/merchant/payouts
 */
router.get('/payouts', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status, search, source } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();
        console.log(`[PAYOUT] Fetching payouts. User: ${req.user.id}, Page: ${page}, Limit: ${limit}, Search: ${search}`);

        let query = 'SELECT * FROM payouts WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND payout_type = ?'; params.push(type); }
        if (source) { query += ' AND source = ?'; params.push(source); }
        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (order_id LIKE ? OR account_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        if (req.query.startDate && req.query.endDate) {
            query += ' AND date(created_at) BETWEEN ? AND ?';
            params.push(req.query.startDate, req.query.endDate);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const payouts = await db.prepare(query).all(...params);

        let countQuery = 'SELECT COUNT(*) as total FROM payouts WHERE user_id = ?';
        const countParams = [req.user.id];
        if (type) { countQuery += ' AND payout_type = ?'; countParams.push(type); }
        if (source) { countQuery += ' AND source = ?'; countParams.push(source); }
        if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
        if (search) {
            countQuery += ' AND (order_id LIKE ? OR account_number LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm);
        }
        if (req.query.startDate && req.query.endDate) {
            countQuery += ' AND date(created_at) BETWEEN ? AND ?';
            countParams.push(req.query.startDate, req.query.endDate);
        }

        const total = (await db.prepare(countQuery).get(...countParams)).total;

        res.json({
            code: 1,
            data: {
                payouts: payouts.map(p => ({
                    id: p.uuid, // Use UUID
                    orderId: p.order_id,
                    amount: p.amount,
                    fee: p.fee,
                    status: p.status,
                    account: p.account_number,
                    ifsc: p.ifsc_code,
                    name: p.account_name,
                    wallet: p.wallet_address,
                    network: p.network_type,
                    utr: p.utr,
                    createdAt: p.created_at,
                    updatedAt: p.updated_at
                })),
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get payouts error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/payouts/export
 * Export payouts to CSV (Chinese)
 */
router.get('/payouts/export', authenticate, async (req, res) => {
    try {
        const { type, status, search, startDate, endDate, source } = req.query;
        const db = getDb();
        console.log(`[PAYOUT EXPORT] User: ${req.user.id}`);

        let query = 'SELECT * FROM payouts WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND payout_type = ?'; params.push(type); }
        if (source) { query += ' AND source = ?'; params.push(source); }
        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (order_id LIKE ? OR account_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        if (startDate && endDate) {
            query += ' AND date(created_at) BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        query += ' ORDER BY created_at DESC';
        const payouts = await db.prepare(query).all(...params);

        // CSV Header (Chinese)
        let csv = '订单号 (Order ID),金额 (Amount),手续费 (Fee),账户 (Account),状态 (Status),UTR,创建时间 (Created Time),更新时间 (Updated Time)\n';

        payouts.forEach(p => {
            let statusCn = '等待';
            if (p.status === 'success') statusCn = '成功';
            else if (p.status === 'failed') statusCn = '失败';
            else if (p.status === 'processing') statusCn = '处理中';

            const account = p.payout_type === 'usdt' ? p.wallet_address : p.account_number;
            // Append 'Z' to force UTC interpretation for correct IST conversion
            const createdDate = new Date(p.created_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' });
            const updatedDate = p.updated_at ? new Date(p.updated_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' }) : '-';

            csv += `${p.order_id},${p.amount},${p.fee},${account || ''},${statusCn},${p.utr || ''},${createdDate},${updatedDate}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment(`payouts-${Date.now()}.csv`);
        res.send(csv);
    } catch (error) {
        console.error('Export payouts error:', error);
        res.status(500).send('Server Error');
    }
});

/**
 * GET /api/merchant/transactions/export
 * Export transactions to CSV (Chinese)
 */
router.get('/transactions/export', authenticate, async (req, res) => {
    try {
        const { type, status, search, startDate, endDate } = req.query;
        const db = getDb();
        console.log(`[TX EXPORT] User: ${req.user.id}, Date: ${startDate}-${endDate}`);

        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        const params = [req.user.id];

        if (type) { query += ' AND type = ?'; params.push(type); }
        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (order_id LIKE ? OR platform_order_id LIKE ? OR utr LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        if (startDate && endDate) {
            query += ' AND date(created_at) BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        query += ' ORDER BY created_at DESC'; // No limit for export
        const transactions = await db.prepare(query).all(...params);

        // CSV Header (Chinese)
        let csv = '订单号 (Order ID),平台订单号 (Platform ID),类型 (Type),金额 (Amount),手续费 (Fee),到账金额 (Net),状态 (Status),UTR,创建时间 (Created Time),更新时间 (Updated Time)\n';

        transactions.forEach(t => {
            const typeCn = t.type === 'payin' ? '代收' : '代付';
            const statusCn = t.status === 'success' ? '成功' : (t.status === 'pending' ? '等待' : '失败');
            // Append 'Z' to force UTC interpretation for correct IST conversion
            const createdDate = new Date(t.created_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' });
            const updatedDate = t.updated_at ? new Date(t.updated_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' }) : '-';

            csv += `${t.order_id},${t.platform_order_id || ''},${typeCn},${t.amount},${t.fee},${t.net_amount},${statusCn},${t.utr || ''},${createdDate},${updatedDate}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment(`transactions-${Date.now()}.csv`);
        res.send(csv);

    } catch (error) {
        console.error('Export transactions error:', error);
        res.status(500).send('Server Error');
    }
});

/**
 * GET /api/merchant/all-transactions
 * Combined history of Payins and Payouts
 */
router.get('/all-transactions', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status, search, startDate, endDate } = req.query;
        const offset = (page - 1) * limit;
        const db = getDb();
        const userId = req.user.id;

        // Base subqueries
        let txQuery = `SELECT uuid as id, order_id, type, amount, fee, net_amount, status, utr, created_at, updated_at FROM transactions WHERE user_id = ?`;
        let poQuery = `SELECT uuid as id, order_id, payout_type as type, amount, fee, net_amount, status, utr, created_at, updated_at FROM payouts WHERE user_id = ?`;

        const params = [userId, userId];

        // We wrap the UNION in a CTE or subquery to apply filters
        // Using common table expression logic via subquery
        let combinedQuery = `
            SELECT * FROM (
                ${txQuery}
                UNION ALL
                ${poQuery}
            ) AS combined
            WHERE 1=1
        `;

        const queryParams = [...params];

        if (type) {
            if (type === 'payin') {
                combinedQuery += " AND type = 'payin'";
            } else if (type === 'payout') {
                combinedQuery += " AND type IN ('bank', 'usdt')";
            } else {
                combinedQuery += " AND type = ?";
                queryParams.push(type);
            }
        }

        if (status) {
            combinedQuery += " AND status = ?";
            queryParams.push(status);
        }

        if (search) {
            combinedQuery += " AND (order_id LIKE ? OR utr LIKE ?)";
            const term = `%${search}%`;
            queryParams.push(term, term);
        }

        if (startDate && endDate) {
            combinedQuery += " AND date(created_at) BETWEEN ? AND ?";
            queryParams.push(startDate, endDate);
        }

        // Pagination
        const finalQuery = combinedQuery + " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        const finalParams = [...queryParams, parseInt(limit), offset];

        const results = await db.prepare(finalQuery).all(...finalParams);

        // Count
        const countQuery = `SELECT COUNT(*) as total FROM (${combinedQuery.split('WHERE 1=1')[0]} WHERE 1=1 ${combinedQuery.split('WHERE 1=1')[1]})`;
        const total = (await db.prepare(countQuery).get(...queryParams)).total;

        res.json({
            code: 1,
            data: {
                transactions: results,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get all transactions error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/merchant/all-transactions/export
 */
router.get('/all-transactions/export', authenticate, async (req, res) => {
    try {
        const { type, status, search, startDate, endDate } = req.query;
        const db = getDb();
        const userId = req.user.id;

        let txQuery = `SELECT order_id, type, amount, fee, net_amount, status, utr, created_at, updated_at FROM transactions WHERE user_id = ?`;
        let poQuery = `SELECT order_id, payout_type as type, amount, fee, net_amount, status, utr, created_at, updated_at FROM payouts WHERE user_id = ?`;

        const params = [userId, userId];

        let combinedQuery = `
            SELECT * FROM (
                ${txQuery}
                UNION ALL
                ${poQuery}
            ) AS combined
            WHERE 1=1
        `;

        const queryParams = [...params];

        if (type) {
            if (type === 'payin') combinedQuery += " AND type = 'payin'";
            else if (type === 'payout') combinedQuery += " AND type IN ('bank', 'usdt')";
            else { combinedQuery += " AND type = ?"; queryParams.push(type); }
        }
        if (status) { combinedQuery += " AND status = ?"; queryParams.push(status); }
        if (search) {
            combinedQuery += " AND (order_id LIKE ? OR utr LIKE ?)";
            const term = `%${search}%`;
            queryParams.push(term, term);
        }
        if (startDate && endDate) {
            combinedQuery += " AND date(created_at) BETWEEN ? AND ?";
            queryParams.push(startDate, endDate);
        }

        const results = await db.prepare(combinedQuery + " ORDER BY created_at DESC").all(...queryParams);

        let csv = '订单号 (Order ID),类型 (Type),金额 (Amount),手续费 (Fee),到账 (Net),状态 (Status),UTR,创建时间 (Created Time),更新时间 (Updated Time)\n';

        results.forEach(r => {
            let typeCn = r.type;
            if (r.type === 'payin') typeCn = '代收';
            else if (r.type === 'bank') typeCn = '银行代付';
            else if (r.type === 'usdt') typeCn = 'USDT代付';

            let statusCn = r.status === 'success' ? '成功' : (r.status === 'pending' || r.status === 'processing' ? '处理中' : '失败');
            // Append 'Z' to force UTC interpretation for correct IST conversion
            const createdDate = new Date(r.created_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' });
            const updatedDate = r.updated_at ? new Date(r.updated_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' }) : '-';

            csv += `${r.order_id},${typeCn},${r.amount},${r.fee},${r.net_amount},${statusCn},${r.utr || ''},${createdDate},${updatedDate}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment(`all_transactions-${Date.now()}.csv`);
        res.send(csv);

    } catch (error) {
        console.error('Export all transactions error:', error);
        res.status(500).send('Server Error');
    }
});

/**
 * GET /api/merchant/stats/chart
 */
router.get('/stats/chart', authenticate, async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const db = getDb();
        const userId = req.user.id;
        console.log(`[CHART] Fetching chart for user ${userId}, days=${days}`);

        // Helper for IST Date String YYYY-MM-DD
        const getISTDate = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // 1. Generate date labels and Date Map
        const labels = [];
        const dateMap = {}; // 'YYYY-MM-DD': { payin: 0, payout: 0 }
        const now = new Date();

        // Loop backwards from days-1 to 0
        for (let i = days - 1; i >= 0; i--) {
            // Subtract i days safely using timestamps (approx 24h chunks)
            // Note: This matches "N days ago" logic. 
            // Better to align with midnight boundaries if needed, but for "last 7 days" 24h chunks usually suffice 
            // if we just want the calendar date of that moment.
            const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
            const dateStr = getISTDate(d);

            // Avoid duplicates if DST/time shifts cause same day (unlikely in pure IST but good safety)
            if (!dateMap[dateStr]) {
                labels.push(dateStr);
                dateMap[dateStr] = { payin: 0, payout: 0 };
            }
        }

        // Make sure we have exactly 'days' labels? 
        // Logic above might produce fewer if multiple 'd' fall on same day, or more if valid.
        // Actually, simple loop is:
        // for (let i = 0; i < days; i++) ...
        // Let's stick to the generated labels for the query range.

        const startDate = labels[0]; // Oldest date
        const endDate = labels[labels.length - 1]; // Newest date (Today)

        // 2. Fetch Aggregated Data using explicit Date Strings
        const stats = await db.prepare(`
            SELECT 
                date(created_at, '+05:30') as date, 
                type, 
                SUM(amount) as total 
            FROM transactions 
            WHERE user_id = ? 
            AND status = 'success' 
            AND date(created_at, '+05:30') >= ?
            GROUP BY date, type
        `).all(userId, startDate);

        stats.forEach(row => {
            if (dateMap[row.date]) {
                if (row.type === 'payin') dateMap[row.date].payin = row.total;
                else if (row.type === 'payout') dateMap[row.date].payout = row.total;
            }
        });

        // 3. Prepare Arrays
        // Ensure we map based on the 'labels' array order
        const payinData = labels.map(d => dateMap[d].payin);
        const payoutData = labels.map(d => dateMap[d].payout);

        // 4. Calculate Top Stats
        const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

        const totals = await db.prepare(`
            SELECT 
                SUM(CASE WHEN type = 'payin' AND status = 'success' THEN amount ELSE 0 END) as totalPayin,
                SUM(CASE WHEN type = 'payout' AND status = 'success' THEN amount ELSE 0 END) as totalPayout
            FROM transactions
            WHERE user_id = ?
        `).get(userId);

        const pending = await db.prepare("SELECT COUNT(*) as count FROM payouts WHERE user_id = ? AND status IN ('pending', 'processing')").get(userId);

        const rates = await db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
            FROM transactions
            WHERE user_id = ? AND type = 'payin'
        `).get(userId);

        const successRate = rates.total > 0 ? ((rates.success / rates.total) * 100).toFixed(1) : 0;

        // Volume Today/Yesterday using explicit JS dates
        const todayStr = getISTDate(new Date());
        const yesterdayStr = getISTDate(new Date(Date.now() - 86400000));

        const volume = await db.prepare(`
            SELECT 
                SUM(CASE WHEN date(created_at, '+05:30') = ? THEN amount ELSE 0 END) as today,
                SUM(CASE WHEN date(created_at, '+05:30') = ? THEN amount ELSE 0 END) as yesterday
            FROM transactions 
            WHERE user_id = ? AND type = 'payin' AND status = 'success'
        `).get(todayStr, yesterdayStr, userId);

        res.json({
            code: 1,
            data: {
                labels,
                payinData,
                payoutData,
                stats: {
                    balance: user.balance,
                    totalPayin: totals.totalPayin || 0,
                    totalPayout: totals.totalPayout || 0,
                    pendingPayouts: pending.count,
                    successRate: successRate,
                    conversionRate: successRate,
                    todayVolume: volume.today || 0,
                    yesterdayVolume: volume.yesterday || 0
                }
            }
        });

    } catch (error) {
        console.error('Chart stats error:', error);
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
                callbackUrl: req.user.callback_url,
                ipWhitelist: req.user.ip_whitelist || '' // Return as string
            }
        });
    } catch (error) {
        console.error('Get credentials error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/merchant/ip-whitelist
 * Update IP Whitelist
 */
router.post('/ip-whitelist', authenticate, async (req, res) => {
    try {
        const { ips } = req.body; // Expects comma separated string
        const db = getDb();

        // Basic validation: Check if IPs are valid structure (optional but recommended)
        // For now text storage

        await db.prepare('UPDATE users SET ip_whitelist = ? WHERE id = ?').run(ips || '', req.user.id);

        res.json({ code: 1, msg: 'IP Whitelist updated' });
    } catch (error) {
        console.error('Update IP whitelist error:', error);
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

        console.log('[MERCHANT PAYIN] Request:', { orderAmount, orderId, userId: merchant.uuid });

        if (!orderAmount) {
            return res.status(400).json({ code: 0, msg: 'orderAmount is required' });
        }

        const result = await createPayinOrder({
            amount: orderAmount,
            orderId: orderId, // Optional, service auto-generates if null
            merchant: merchant,
            callbackUrl: callbackUrl,
            skipUrl: skipUrl,
            param: param
        });

        res.json({
            code: 1,
            msg: 'Order created',
            data: {
                orderId: result.orderId,
                id: result.id,
                orderAmount: result.amount,
                fee: result.fee,
                rechargeUrl: result.paymentUrl,
                paymentUrl: result.paymentUrl
            }
        });

    } catch (error) {
        console.error('[MERCHANT PAYIN] Error:', error);
        const code = error.message.includes('Minimum') || error.message.includes('exists') ? 400 : 500;
        res.status(code).json({ code: 0, msg: error.message });
    }
});

module.exports = router;
