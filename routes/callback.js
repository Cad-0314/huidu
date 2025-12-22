const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { getDb } = require('../config/database');
const silkpayService = require('../services/silkpay');
const { calculatePayinFee, calculatePayoutFee } = require('../utils/rates');
const { generateSign } = require('../utils/signature');

/**
 * POST /api/callback/silkpay/payin
 * Handles callbacks from Silkpay for Payin Orders
 */
router.post('/silkpay/payin', async (req, res) => {
    try {
        console.log('Silkpay Payin Callback received:', req.body);
        const { status, amount, payOrderId, mId, mOrderId, sign, utr, timestamp } = req.body;
        const db = getDb();

        // 1. Log Raw Callback
        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('payin', ?, ?, ?, datetime('now'))`)
            .run(mOrderId || payOrderId, JSON.stringify(req.body), status);

        // 2. Find Transaction
        // Try platform_order_id (payOrderId) first, then order_id (mOrderId)
        let tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ?')
            .get(payOrderId);

        if (!tx) {
            tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.order_id = ?')
                .get(mOrderId);
        }

        if (!tx) {
            console.warn(`[Silkpay Payin] Transaction not found for payOrderId: ${payOrderId}, mOrderId: ${mOrderId}`);
            return res.send('OK');
        }

        // 3. Determine Secret & Verify Signature
        let secretToUse = process.env.SILKPAY_SECRET;
        if (tx.username === 'demo') {
            secretToUse = 'SIb3DQEBAQ'; // Sandbox Secret
        }

        if (!silkpayService.verifyPayinCallback(req.body, secretToUse)) {
            console.error(`[Silkpay Payin API SECURITY] Signature Mismatch for Order ${tx.order_id}`);
            // Log verification details for debugging
            const str = `${amount}${mId}${mOrderId}${timestamp}${secretToUse}`;
            const calculated = crypto.createHash('md5').update(str).digest('hex').toLowerCase();
            console.error(`Expected: ${calculated}, Received: ${sign}`);
            return res.send('OK'); // Return OK to stop retries if signature is invalid (or 400?) - Silkpay expects OK.
        }

        // 4. Update Transaction Status
        const newStatus = (status === '1' || status === 1) ? 'success' : 'failed';
        const actualAmount = parseFloat(amount);

        // Calculate Fees
        const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
        const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

        // Logic check: prevent double success
        if (tx.status === 'success' && newStatus === 'success') {
            console.log(`[Silkpay Payin] Order ${tx.order_id} already success. Ignoring duplicate.`);
            // Still notify merchant? Maybe.
        } else {
            // Update DB
            await db.prepare(`
                UPDATE transactions 
                SET status = ?, amount = ?, fee = ?, net_amount = ?, utr = ?, callback_data = ?, updated_at = datetime('now') 
                WHERE id = ?
            `).run(newStatus, actualAmount, fee, netAmount, utr || null, JSON.stringify(req.body), tx.id);

            // Credit Balance if Success
            if (newStatus === 'success') {
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);
                console.log(`[Silkpay Payin] Credited ₹${netAmount} to ${tx.username}`);

                // Credit Admin Profit
                try {
                    const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
                    const adminCostRate = settings ? parseFloat(settings.value) : 0.05; // Default cost 5%
                    const cost = actualAmount * adminCostRate;
                    const profit = fee - cost;

                    if (profit !== 0) {
                        await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(profit);
                    }
                } catch (e) {
                    console.error('Failed to credit admin profit:', e);
                }
            }
        }

        // 5. Forward Callback to Merchant
        // Response to Silkpay first
        res.send('OK');

        // Prepare Callback Data
        let callbackUrl = tx.callback_url;
        let originalParam = tx.param; // Default

        // Check if param contains redirect/callback override
        try {
            if (tx.param) {
                const parsed = JSON.parse(tx.param);
                if (parsed.c) callbackUrl = parsed.c;
                if (parsed.p !== undefined) originalParam = parsed.p;
            }
        } catch (e) { }

        if (callbackUrl) {
            const merchantCallbackData = {
                status: newStatus === 'success' ? 1 : 0,
                amount: netAmount,
                orderAmount: actualAmount,
                orderId: tx.order_id,
                id: tx.uuid,
                utr: utr || '',
                param: originalParam || '' // Forward pure param
            };

            // Sign using Merchant Key
            merchantCallbackData.sign = generateSign(merchantCallbackData, tx.merchant_key);

            console.log(`[Silkpay Payin] Forwarding callback to ${callbackUrl}`);
            try {
                // Post with timeout
                await axios.post(callbackUrl, merchantCallbackData, { timeout: 10000 });
            } catch (err) {
                console.error(`[Silkpay Payin] Failed to forward callback to ${callbackUrl}:`, err.message);
                // Log failure to db if needed
            }
        }

    } catch (error) {
        console.error('Silkpay Payin Callback Error:', error);
        if (!res.headersSent) res.status(200).send('OK'); // Always return OK to Silkpay
    }
});

/**
 * POST /api/callback/silkpay/payout
 * Handles callbacks from Silkpay for Payout Orders
 */
router.post('/silkpay/payout', async (req, res) => {
    try {
        console.log('Silkpay Payout Callback received:', req.body);
        const { status, amount, payOrderId, message, mOrderId, utr, sign, timestamp, mId } = req.body;
        const db = getDb();

        const orderId = mOrderId; // Silkpay sends mOrderId as the merchant order ID

        // 1. Log Raw Callback
        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('payout', ?, ?, ?, datetime('now'))`)
            .run(orderId || payOrderId, JSON.stringify(req.body), status);

        // 2. Find Payout
        let payout = await db.prepare('SELECT p.*, u.callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ?')
            .get(payOrderId);

        if (!payout) {
            payout = await db.prepare('SELECT p.*, u.callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?')
                .get(orderId);
        }

        if (!payout) {
            console.warn(`[Silkpay Payout] Transaction not found for payOrderId: ${payOrderId}, mOrderId: ${orderId}`);
            return res.send('OK');
        }

        // 3. Determine Secret & Verify
        let secretToUse = process.env.SILKPAY_SECRET;
        if (payout.username === 'demo') {
            secretToUse = 'SIb3DQEBAQ';
        }

        if (!silkpayService.verifyPayoutCallback(req.body, secretToUse)) {
            console.error(`[Silkpay Payout API SECURITY] Signature Mismatch for Order ${payout.order_id}`);
            const str = `${mId}${mOrderId}${amount}${timestamp}${secretToUse}`;
            const calculated = crypto.createHash('md5').update(str).digest('hex').toLowerCase();
            console.error(`Expected: ${calculated}, Received: ${sign}`);
            return res.send('OK');
        }

        // 4. Update Status
        // Silkpay Status: 2 = Success, 3 = Failed (Pending=1)
        const newStatus = (status === '2' || status === 2) ? 'success' : 'failed';

        if (payout.status === 'success' && newStatus === 'success') {
            // Already processed
            console.log(`[Silkpay Payout] Order ${payout.order_id} already success.`);
        } else {
            await db.prepare(`UPDATE payouts SET status = ?, utr = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(newStatus, utr || null, message || null, JSON.stringify(req.body), payout.id);

            // Refund if failed AND not already failed/refunded
            if (newStatus === 'failed' && payout.status !== 'failed') {
                console.log(`[Silkpay Payout] Failed. Refunding ${payout.amount + payout.fee} to ${payout.username}`);
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.amount + payout.fee, payout.user_id);
            }

            // Credit Admin Profit if Success
            if (newStatus === 'success' && payout.status !== 'success') {
                // Profit = Fee (Simplification, assuming no cost from Silkpay for now or absorbed)
                if (payout.fee > 0) {
                    await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(payout.fee);
                }
            }
        }

        // 5. Forward Callback
        res.send('OK');

        if (payout.callback_url) {
            const merchantCallbackData = {
                status: newStatus === 'success' ? 1 : 2,
                amount: payout.amount,
                commission: payout.fee,
                message: message || (newStatus === 'success' ? 'success' : 'failed'),
                orderId: payout.order_id,
                id: payout.uuid,
                utr: utr || '',
                param: ''
            };
            merchantCallbackData.sign = generateSign(merchantCallbackData, payout.merchant_key);

            console.log(`[Silkpay Payout] Forwarding callback to ${payout.callback_url}`);
            try {
                await axios.post(payout.callback_url, merchantCallbackData, { timeout: 10000 });
            } catch (err) {
                console.error(`[Silkpay Payout] Failed to forward callback: ${err.message}`);
            }
        }

    } catch (error) {
        console.error('Silkpay Payout Callback Error:', error);
        if (!res.headersSent) res.status(200).send('OK');
    }
});

module.exports = router;
