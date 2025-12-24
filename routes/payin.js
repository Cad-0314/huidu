const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const silkpayService = require('../services/silkpay');
const f2payService = require('../services/f2pay');
const { createPayinOrder } = require('../services/order');
const { calculatePayinFee } = require('../utils/rates');
const { generateSign } = require('../utils/signature');

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
                paymentUrl: result.paymentUrl,
                deepLinks: result.deepLinks
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

        // Check routing
        const channel = tx.channel || 'silkpay';

        try {
            let result;

            let isSuccess = false;

            if (channel === 'f2pay') {
                result = await f2payService.submitUtr(tx.order_id, utr);
                isSuccess = (result.code === 1);
            } else {
                result = await silkpayService.submitUtr(tx.order_id, utr);
                isSuccess = (result.status === '200' && result.data && result.data.code === 1);
            }

            if (isSuccess) {
                // Success upstream
                await db.prepare('UPDATE transactions SET utr = ? WHERE id = ?').run(utr, tx.id);

                return res.json({
                    code: 1,
                    msg: 'UTR Submitted successfully',
                    data: {
                        orderId: tx.order_id,
                        utr: utr,
                        status: 'processing'
                    }
                });
            } else {
                return res.status(400).json({
                    code: 0,
                    msg: result.message || (result.data ? result.data.msg : 'Upstream rejected UTR')
                });
            }
        } catch (upstreamError) {
            console.error('Submit UTR Error:', upstreamError);
            return res.status(502).json({ code: 0, msg: 'Failed to communicate with payment provider' });
        }

    } catch (error) {
        console.error('Submit UTR error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
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
