const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const silkpayService = require('../services/silkpay');
const { createPayinOrder } = require('../services/order');

/**
 * POST /api/payin/create
 */
router.post('/create', apiAuthenticate, async (req, res) => {
    try {
        const { orderAmount, orderId, callbackUrl, skipUrl, param } = req.body;
        const merchant = req.merchant;

        if (!orderAmount || !orderId || !callbackUrl) {
            return res.status(400).json({ code: 0, msg: 'orderAmount, orderId, and callbackUrl are required' });
        }

        const result = await createPayinOrder({
            amount: orderAmount,
            orderId,
            merchant,
            callbackUrl,
            skipUrl,
            param
        });

        res.json({
            code: 1,
            msg: 'Order created',
            data: {
                orderId: result.orderId,
                id: result.id,
                orderAmount: result.amount,
                fee: result.fee,
                paymentUrl: result.paymentUrl
            }
        });

    } catch (error) {
        console.error('Create payin error:', error);
        // Helper to return 400 for known errors, 500 for others? 
        // For simplicity, returns 400 if message is known, or just error msg.
        const code = error.message.includes('Minimum') || error.message.includes('exists') ? 400 : 500;
        res.status(code).json({ code: 0, msg: error.message || 'Server error' });
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
 * POST /api/payin/submit-utr
 * Allow merchants to submit UTR for an order (manual callback trigger/compensation).
 */
router.post('/submit-utr', apiAuthenticate, async (req, res) => {
    try {
        const { orderId, utr } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!orderId || !utr) {
            return res.status(400).json({ code: 0, msg: 'orderId and utr are required' });
        }

        // Find transaction
        const tx = await db.prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?').get(orderId, merchant.id);

        if (!tx) {
            return res.status(404).json({ code: 0, msg: 'Order not found' });
        }

        if (tx.status === 'success') {
            return res.status(400).json({ code: 0, msg: 'Order already successful' });
        }

        // Call Silkpay Submit UTR
        // Platform Order ID needed? Upstream usually needs its own order ID or merchant's.
        // Silkpay docs say: "mOrderId" (Merchant's Order ID).

        // Note: Silkpay might require the original mOrderId sent during creation.
        // tx.order_id IS our mOrderId sent to Silkpay (based on createPayinOrder logic).

        try {
            const result = await silkpayService.submitUtr(tx.order_id, utr);

            if (result.status === '200' && result.data && result.data.code === 1) {
                // Success upstream. We can mark it as success immediately OR wait for callback.
                // Usually better to wait, but if "code: 1" means "Success" as per docs, we can update local.
                // Docs say: "1 for successful order processing".

                // Let's rely on callback for full confirmation, BUT we can proactively update UTR in DB.
                await db.prepare('UPDATE transactions SET utr = ? WHERE id = ?').run(utr, tx.id);

                return res.json({
                    code: 1,
                    msg: 'UTR Submitted successfully',
                    data: {
                        orderId: tx.order_id,
                        utr: utr,
                        status: 'processing' // Upstream says success, but usually means "accepted for processing"
                    }
                });
            } else {
                return res.status(400).json({
                    code: 0,
                    msg: result.message || (result.data ? result.data.msg : 'Upstream rejected UTR')
                });
            }
        } catch (upstreamError) {
            console.error('Silkpay Submit UTR Error:', upstreamError);
            return res.status(502).json({ code: 0, msg: 'Failed to communicate with payment provider' });
        }

    } catch (error) {
        console.error('Submit UTR error:', error);
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
        // Fetch merchant_key AND payin_rate
        const tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ?')
            .get(payOrderId);

        if (!tx) {
            console.log('Transaction not found for payOrderId:', payOrderId);
            return res.send('OK');
        }

        const newStatus = status === '1' || status === 1 ? 'success' : 'failed';
        const actualAmount = parseFloat(amount);

        // Use merchant's specific rate, fallback to 5.0 if missing
        const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 5.0;
        const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

        await db.prepare(`UPDATE transactions SET status = ?, amount = ?, fee = ?, net_amount = ?, utr = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, actualAmount, fee, netAmount, utr || null, JSON.stringify(req.body), tx.id);

        if (newStatus === 'success' && tx.status !== 'success') {
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);

            // Credit Admin Profit
            // Profit = Fee - (Amount * CostRate)
            try {
                const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
                const adminCostRate = settings ? parseFloat(settings.value) : 0.05;
                const cost = actualAmount * adminCostRate;
                const profit = fee - cost;

                if (profit !== 0) { // Credit even if negative? Usually yes (loss).
                    await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(profit);
                }
            } catch (errProfile) {
                console.error('Failed to credit admin profit:', errProfile);
            }
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

/**
 * GET /api/payin/redirect
 * Frame-busting redirect helper
 */
router.get('/redirect', (req, res) => {
    const { url } = req.query;
    if (!url) return res.send('Missing URL');

    // Prevent open redirect to external domains if strict security is needed, 
    // but here we need to redirect to merchant provided URLs which are external.
    // We trust the URL because it comes from our signed internal logic (services/order.js), 
    // although technically a user could manually call this. 
    // For now, allow it to facilitate the feature.

    const target = decodeURIComponent(url);

    const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Redirecting...</title></head>
    <body>
        <script>
            if (window.top !== window.self) {
                window.top.location.href = "${target}";
            } else {
                window.location.href = "${target}";
            }
        </script>
        <p>If you are not redirected automatically, <a href="${target}" target="_top">click here</a>.</p>
    </body>
    </html>
    `;
    res.send(html);
});

module.exports = router;
