const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const silkpayService = require('../services/silkpay');
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
                    createdAt: t.created_at
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
                    createdAt: p.created_at
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
        let csv = '订单号 (Order ID),金额 (Amount),手续费 (Fee),账户 (Account),状态 (Status),UTR,时间 (Time)\n';

        payouts.forEach(p => {
            let statusCn = '等待';
            if (p.status === 'success') statusCn = '成功';
            else if (p.status === 'failed') statusCn = '失败';
            else if (p.status === 'processing') statusCn = '处理中';

            const account = p.payout_type === 'usdt' ? p.wallet_address : p.account_number;
            const date = new Date(p.created_at).toLocaleString('zh-CN');

            csv += `${p.order_id},${p.amount},${p.fee},${account || ''},${statusCn},${p.utr || ''},${date}\n`;
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
        let csv = '订单号 (Order ID),平台订单号 (Platform ID),类型 (Type),金额 (Amount),手续费 (Fee),到账金额 (Net),状态 (Status),UTR,时间 (Time)\n';

        transactions.forEach(t => {
            const typeCn = t.type === 'payin' ? '代收' : '代付';
            const statusCn = t.status === 'success' ? '成功' : (t.status === 'pending' ? '等待' : '失败');
            const date = new Date(t.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' }); // Approx

            csv += `${t.order_id},${t.platform_order_id || ''},${typeCn},${t.amount},${t.fee},${t.net_amount},${statusCn},${t.utr || ''},${date}\n`;
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
        let txQuery = `SELECT uuid as id, order_id, type, amount, fee, net_amount, status, utr, created_at FROM transactions WHERE user_id = ?`;
        let poQuery = `SELECT uuid as id, order_id, payout_type as type, amount, fee, net_amount, status, utr, created_at FROM payouts WHERE user_id = ?`;

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

        let txQuery = `SELECT order_id, type, amount, fee, net_amount, status, utr, created_at FROM transactions WHERE user_id = ?`;
        let poQuery = `SELECT order_id, payout_type as type, amount, fee, net_amount, status, utr, created_at FROM payouts WHERE user_id = ?`;

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

        let csv = '订单号 (Order ID),类型 (Type),金额 (Amount),手续费 (Fee),到账 (Net),状态 (Status),UTR,时间 (Time)\n';

        results.forEach(r => {
            let typeCn = r.type;
            if (r.type === 'payin') typeCn = '代收';
            else if (r.type === 'bank') typeCn = '银行代付';
            else if (r.type === 'usdt') typeCn = 'USDT代付';

            let statusCn = r.status === 'success' ? '成功' : (r.status === 'pending' || r.status === 'processing' ? '处理中' : '失败');
            const date = new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Kolkata' });

            csv += `${r.order_id},${typeCn},${r.amount},${r.fee},${r.net_amount},${statusCn},${r.utr || ''},${date}\n`;
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

        // 1. Generate date labels
        const labels = [];
        const dateMap = {}; // 'YYYY-MM-DD': { payin: 0, payout: 0 }

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            labels.push(dateStr);
            dateMap[dateStr] = { payin: 0, payout: 0 };
        }

        // 2. Fetch Aggregated Data
        const stats = await db.prepare(`
            SELECT 
                date(created_at) as date, 
                type, 
                SUM(amount) as total 
            FROM transactions 
            WHERE user_id = ? 
            AND status = 'success' 
            AND created_at >= date('now', '-' || ? || ' days')
            GROUP BY date, type
        `).all(userId, days);

        stats.forEach(row => {
            if (dateMap[row.date]) {
                if (row.type === 'payin') dateMap[row.date].payin = row.total;
                else if (row.type === 'payout') dateMap[row.date].payout = row.total;
            }
        });

        // 3. Prepare Arrays
        const payinData = labels.map(d => dateMap[d].payin);
        const payoutData = labels.map(d => dateMap[d].payout);

        // 4. Calculate Top Stats
        // Balance
        const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

        // Total Payin/Payout (All time)
        const totals = await db.prepare(`
            SELECT 
                SUM(CASE WHEN type = 'payin' AND status = 'success' THEN amount ELSE 0 END) as totalPayin,
                SUM(CASE WHEN type = 'payout' AND status = 'success' THEN amount ELSE 0 END) as totalPayout
            FROM transactions
            WHERE user_id = ?
        `).get(userId);

        // Pending Payouts
        const pending = await db.prepare("SELECT COUNT(*) as count FROM payouts WHERE user_id = ? AND status IN ('pending', 'processing')").get(userId);

        // Success Rate
        const rates = await db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
            FROM transactions
            WHERE user_id = ? AND type = 'payin'
        `).get(userId);

        const successRate = rates.total > 0 ? ((rates.success / rates.total) * 100).toFixed(1) : 0;

        // Volume Today/Yesterday
        const volume = await db.prepare(`
            SELECT 
                SUM(CASE WHEN date(created_at) = date('now') THEN amount ELSE 0 END) as today,
                SUM(CASE WHEN date(created_at) = date('now', '-1 day') THEN amount ELSE 0 END) as yesterday
            FROM transactions 
            WHERE user_id = ? AND type = 'payin' AND status = 'success'
        `).get(userId);

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
                    conversionRate: successRate, // Placeholder
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
        const ourSkipUrl = `${appUrl}/api/payin/redirect?url=${encodeURIComponent(skipUrl || `${appUrl}/payment/complete`)}`;

        console.log('[MERCHANT PAYIN] Calling Silkpay API...');

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

        await db.prepare(`
            INSERT INTO transactions (uuid, user_id, order_id, platform_order_id, type, amount, order_amount, fee, net_amount, status, payment_url, param)
            VALUES (?, ?, ?, ?, 'payin', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(txUuid, merchant.id, orderId, silkpayResponse.data.payOrderId || internalOrderId, amount, amount, fee, netAmount, silkpayResponse.data.paymentUrl, storedParam);

        const localPaymentUrl = `${appUrl}/pay/${silkpayResponse.data.payOrderId || internalOrderId}`;

        res.json({
            code: 1,
            msg: 'Order created',
            data: { orderId, id: txUuid, orderAmount: amount, fee, rechargeUrl: localPaymentUrl, paymentUrl: localPaymentUrl }
        });
    } catch (error) {
        console.error('[MERCHANT PAYIN] Error:', error);
        res.status(500).json({ code: 0, msg: 'Server error: ' + error.message });
    }
});

module.exports = router;
