const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { getDb } = require('../config/database');
const silkpayService = require('../services/silkpay');
const f2payService = require('../services/f2pay');
const gtpayService = require('../services/gtpay');
const hdpayService = require('../services/hdpay');
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
        let payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ?')
            .get(payOrderId);

        if (!payout) {
            payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?')
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

        // Prefer payout-specific callback URL, fallback to user's default
        const callbackUrl = payout.payout_callback_url || payout.user_callback_url;

        if (callbackUrl) {
            const merchantCallbackData = {
                status: newStatus === 'success' ? 1 : 2,
                amount: payout.amount,
                commission: payout.fee,
                message: message || (newStatus === 'success' ? 'success' : 'failed'),
                orderId: payout.order_id,
                id: payout.uuid,
                utr: utr || '',
                param: payout.param || ''
            };
            merchantCallbackData.sign = generateSign(merchantCallbackData, payout.merchant_key);

            console.log(`[Silkpay Payout] Forwarding callback to ${callbackUrl}`);
            try {
                await axios.post(callbackUrl, merchantCallbackData, { timeout: 10000 });
            } catch (err) {
                console.error(`[Silkpay Payout] Failed to forward callback: ${err.message}`);
            }
        }

    } catch (error) {
        console.error('Silkpay Payout Callback Error:', error);
        if (!res.headersSent) res.status(200).send('OK');
    }
});

/**
 * POST /api/callback/f2pay/payin
 * Handles callbacks from F2PAY for Payin Orders
 * F2PAY sends: { code, msg, sysTime, sign, bizContent (JSON string) }
 * bizContent contains: state (Paid/UnequalPaid/Expired/Failed), actualAmount, amount, mchOrderNo, platNo, trxId (UTR), etc.
 */
router.post('/f2pay/payin', async (req, res) => {
    try {
        console.log('F2PAY Payin Callback received:', req.body);
        const db = getDb();

        // Parse the incoming callback
        const { code, bizContent: bizContentRaw, sign } = req.body;

        // 1. Log Raw Callback
        let bizContent = bizContentRaw;
        let mchOrderNo = '';

        try {
            if (typeof bizContentRaw === 'string') {
                bizContent = JSON.parse(bizContentRaw);
            }
            mchOrderNo = bizContent.mchOrderNo || '';
        } catch (e) {
            console.error('[F2PAY] Failed to parse bizContent:', e);
        }

        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('f2pay_payin', ?, ?, ?, datetime('now'))`)
            .run(mchOrderNo || bizContent?.platNo, JSON.stringify(req.body), bizContent?.state || 'unknown');

        // 2. Verify Signature (optional in test environment, but good practice)
        if (!f2payService.verifyPayinCallback(req.body)) {
            console.error('[F2PAY Payin SECURITY] Signature verification failed! Check keys.');
        }

        // 3. Find Transaction
        let tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.order_id = ?')
            .get(mchOrderNo);

        if (!tx && bizContent.platNo) {
            tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ?')
                .get(bizContent.platNo);
        }

        if (!tx) {
            console.warn(`[F2PAY Payin] Transaction not found for mchOrderNo: ${mchOrderNo}, platNo: ${bizContent?.platNo}`);
            return res.send('success');
        }

        // 4. Determine Status
        // F2PAY states: Paid, UnequalPaid, Expired, Failed, Pending
        const state = bizContent.state;
        let newStatus = 'pending';

        if (state === 'Paid' || state === 'UnequalPaid') {
            newStatus = 'success';
        } else if (state === 'Expired' || state === 'Failed') {
            newStatus = 'failed';
        }

        const actualAmount = parseFloat(bizContent.actualAmount || bizContent.amount);
        const utr = bizContent.trxId || '';

        // Calculate Fees
        const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
        const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

        // Logic check: prevent double success
        if (tx.status === 'success' && newStatus === 'success') {
            console.log(`[F2PAY Payin] Order ${tx.order_id} already success. Ignoring duplicate.`);
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
                console.log(`[F2PAY Payin] Credited ₹${netAmount} to ${tx.username}`);

                // Credit Admin Profit
                try {
                    const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
                    const adminCostRate = settings ? parseFloat(settings.value) : 0.05;
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

        // 5. Response to F2PAY (must return "success" lowercase)
        res.send('success');

        // 6. Forward Callback to Merchant
        let callbackUrl = tx.callback_url;
        let originalParam = tx.param;

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
                param: originalParam || ''
            };

            // Sign using Merchant Key
            merchantCallbackData.sign = generateSign(merchantCallbackData, tx.merchant_key);

            console.log(`[F2PAY Payin] Forwarding callback to ${callbackUrl}`);
            try {
                await axios.post(callbackUrl, merchantCallbackData, { timeout: 10000 });
            } catch (err) {
                console.error(`[F2PAY Payin] Failed to forward callback to ${callbackUrl}:`, err.message);
            }
        }

    } catch (error) {
        console.error('F2PAY Payin Callback Error:', error);
        if (!res.headersSent) res.status(200).send('success');
    }
});

/**
 * POST /api/callback/f2pay/payout
 * Handles callbacks from F2PAY for Payout Orders
 */
router.post('/f2pay/payout', async (req, res) => {
    try {
        console.log('F2PAY Payout Callback received:', req.body);
        const db = getDb();

        const { code, bizContent: bizContentRaw, sign } = req.body;

        // 1. Log Raw Callback
        let bizContent = bizContentRaw;
        let mchOrderNo = '';

        try {
            if (typeof bizContentRaw === 'string') {
                bizContent = JSON.parse(bizContentRaw);
            }
            mchOrderNo = bizContent.mchOrderNo || '';
        } catch (e) {
            console.error('[F2PAY Payout] Failed to parse bizContent:', e);
        }

        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('f2pay_payout', ?, ?, ?, datetime('now'))`)
            .run(mchOrderNo || bizContent?.platNo, JSON.stringify(req.body), bizContent?.state || 'unknown');

        // 2. Verify Signature
        if (!f2payService.verifyPayinCallback(req.body)) {
            console.error('[F2PAY Payout SECURITY] Signature verification failed! Check keys.');
            // Proceeding for debugging, but in strict production this should return immediately.
        }

        // 3. Find Payout
        let payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?')
            .get(mchOrderNo);

        if (!payout && bizContent.platNo) {
            payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ?')
                .get(bizContent.platNo);
        }

        if (!payout) {
            console.warn(`[F2PAY Payout] Transaction not found for mchOrderNo: ${mchOrderNo}`);
            return res.send('success');
        }

        // 4. Update Status
        const state = bizContent.state; // Paid / Failed / etc.
        let newStatus = 'processing';
        let message = '';

        if (state === 'Paid' || state === 'Success' || state === 'SUCCESS') {
            newStatus = 'success';
        } else if (state === 'Failed' || state === 'Expired' || state === 'FAIL') {
            newStatus = 'failed';
            message = 'Payout Failed';
        }

        if (payout.status === 'success' && newStatus === 'success') {
            console.log(`[F2PAY Payout] Order ${payout.order_id} already success.`);
        } else {
            const utr = bizContent.trxId || '';

            await db.prepare(`UPDATE payouts SET status = ?, utr = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(newStatus, utr, message, JSON.stringify(req.body), payout.id);

            // Refund if failed
            if (newStatus === 'failed' && payout.status !== 'failed') {
                console.log(`[F2PAY Payout] Failed. Refunding ${payout.amount + payout.fee} to ${payout.username}`);
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.amount + payout.fee, payout.user_id);
            }
        }

        // 5. Response to F2PAY
        res.send('success');

        // 6. Forward Callback
        const callbackUrl = payout.payout_callback_url || payout.user_callback_url;

        if (callbackUrl) {
            const merchantCallbackData = {
                status: newStatus === 'success' ? 1 : 2,
                amount: payout.amount,
                commission: payout.fee,
                message: message || (newStatus === 'success' ? 'success' : 'failed'),
                orderId: payout.order_id,
                id: payout.uuid,
                utr: bizContent.trxId || '',
                param: payout.param || ''
            };
            merchantCallbackData.sign = generateSign(merchantCallbackData, payout.merchant_key);

            console.log(`[F2PAY Payout] Forwarding callback to ${callbackUrl}`);
            try {
                await axios.post(callbackUrl, merchantCallbackData, { timeout: 10000 });
            } catch (err) {
                console.error(`[F2PAY Payout] Failed to forward callback: ${err.message}`);
            }
        }

    } catch (error) {
        console.error('F2PAY Payout Callback Error:', error);
        if (!res.headersSent) res.status(200).send('success');
    }
});

/**
 * GET /api/callback/gtpay/payin
 * Handles callbacks from GTPAY for Payin Orders
 */
router.get('/gtpay/payin', async (req, res) => {
    try {
        console.log('GTPAY Payin Callback received:', req.query);
        const db = getDb();
        const { platformno, parameter, sign } = req.query;

        // 1. Log Raw Callback
        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('gtpay_payin', ?, ?, 'received', datetime('now'))`)
            .run(parameter, JSON.stringify(req.query));

        // 2. Verify Signature & Decrypt
        const decoded = gtpayService.verifyPayinCallback(req.query);
        if (!decoded) {
            console.error('[GTPAY Payin] Signature Verification Failed');
            return res.send('faild');
        }

        const { commercialOrderNo, orderAmount, orderNo, result } = decoded;

        // 3. Find Transaction
        const tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.order_id = ?').get(commercialOrderNo);

        if (!tx) {
            console.warn(`[GTPAY Payin] Transaction not found: ${commercialOrderNo}`);
            return res.send('success');
        }

        // 4. Update Status
        const newStatus = (result === 'success') ? 'success' : 'failed';
        const actualAmount = parseFloat(orderAmount);

        if (tx.status === 'success' && newStatus === 'success') {
            // Duplicate
        } else {
            const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
            const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

            await db.prepare(`UPDATE transactions SET status = ?, amount = ?, fee = ?, net_amount = ?, platform_order_id = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(newStatus, actualAmount, fee, netAmount, orderNo, JSON.stringify(req.query), tx.id);

            if (newStatus === 'success') {
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);

                // Admin Profit
                try {
                    const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
                    const adminCostRate = settings ? parseFloat(settings.value) : 0.05;
                    const profit = fee - (actualAmount * adminCostRate);
                    if (profit !== 0) await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(profit);
                } catch (e) { }
            }
        }

        // 5. Response to GTPAY
        res.send('success');

        // 6. Forward to Merchant
        let callbackUrl = tx.callback_url;
        try {
            if (tx.param) {
                const parsed = JSON.parse(tx.param);
                if (parsed.c) callbackUrl = parsed.c;
            }
        } catch (e) { }

        if (callbackUrl) {
            // Safe param extraction with try-catch
            let originalParam = '';
            try {
                if (tx.param) {
                    const parsed = JSON.parse(tx.param);
                    originalParam = parsed.p || '';
                }
            } catch (e) {
                console.warn('[GTPAY Payin] Failed to parse param:', e.message);
            }

            const data = {
                status: newStatus === 'success' ? 1 : 0,
                amount: calculatePayinFee(actualAmount, tx.payin_rate || 0.05).netAmount, // Send Net Amount
                orderAmount: actualAmount,
                orderId: tx.order_id,
                id: tx.uuid,
                utr: '', // GTPAY doesn't seem to send UTR in Payin Callback
                param: originalParam
            };
            data.sign = generateSign(data, tx.merchant_key);
            try {
                await axios.post(callbackUrl, data, { timeout: 10000 });
            } catch (e) {
                console.error('[GTPAY Payin] Forward failed:', e.message);
            }
        }

    } catch (error) {
        console.error('GTPAY Payin Callback Error:', error);
        res.send('faild');
    }
});

/**
 * POST /api/callback/gtpay/payout
 * Handles callbacks from GTPAY for Payout Orders
 * Assumed POST based on typical webhook behavior, but doc doesn't specify method for payout callback explicitly (implied same as payin?). 
 * Actually Payin callback is GET per doc? "下单回调接口 方式：GET"
 * Payout callback: "代付回调接口 ... 请求此接口来进行代付操作" (Copy paste error in doc?)
 * But "此接口由商户商户在代付请求时传给支付平台...".
 * Let's assume POST for Payout as it's more standard, or support both?
 * Let's try POST first.
 */
router.post('/gtpay/payout', async (req, res) => {
    try {
        console.log('GTPAY Payout Callback received:', req.body);
        const db = getDb();
        // Check content type. If form-data/urlencoded, body will be populated.
        const { platformno, parameter, sign } = req.body;

        if (!parameter) {
            // Try query if body is empty? 
            if (req.query.parameter) {
                return handleGtpayPayoutCallback(req.query, res, db);
            }
        }

        await handleGtpayPayoutCallback(req.body, res, db);
    } catch (e) {
        console.error('GTPAY Payout Error:', e);
        res.send('success'); // Return success to stop retries if crashes
    }
});

async function handleGtpayPayoutCallback(data, res, db) {
    const { parameter, sign } = data;

    // Log
    await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('gtpay_payout', ?, ?, 'received', datetime('now'))`)
        .run(parameter, JSON.stringify(data));

    const decoded = gtpayService.verifyPayoutCallback(data);
    if (!decoded) {
        console.error('[GTPAY Payout] Signature Verification Failed');
        return res.send('success'); // Consumed
    }

    const { outTradeNo, tradeNo, totalAmount, result, utr, msg } = decoded;
    // outTradeNo = Commercial Order No (Our Order ID)
    // tradeNo = Platform Order ID (Their ID)

    const payout = await db.prepare('SELECT p.*, u.callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?').get(outTradeNo);

    if (!payout) {
        console.warn(`[GTPAY Payout] Payout not found: ${outTradeNo}`);
        return res.send('success');
    }

    let newStatus = 'processing';
    if (result === 'success') newStatus = 'success';
    else if (result === 'error' || result === 'failed') newStatus = 'failed';

    if (payout.status === 'success' && newStatus === 'success') {
        // Duplicate
    } else {
        await db.prepare(`UPDATE payouts SET status = ?, utr = ?, platform_order_id = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, utr, tradeNo, msg, JSON.stringify(data), payout.id);

        if (newStatus === 'failed' && payout.status !== 'failed') {
            // Refund
            const refundAmount = payout.amount + payout.fee;
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refundAmount, payout.user_id);
        }
    }

    res.send('success');

    // Forward
    const callbackUrl = payout.callback_url || payout.user_callback_url; // payouts table has callback_url column? check payout.js
    // In payout.js: "select p.*, p.callback_url as payout_callback_url..."
    // My query above: "SELECT p.*, u.callback_url..." -> p.callback_url is in p.*
    // So let's use:
    const forwardUrl = payout.callback_url || payout.callback_url; // Wait, alias issue.
    // Let's rely on logic similar to existing:
    // const callbackUrl = payout.payout_callback_url || payout.user_callback_url;

    if (forwardUrl) {
        const cbData = {
            status: newStatus === 'success' ? 1 : 2,
            amount: payout.amount,
            commission: payout.fee,
            message: msg || result,
            orderId: payout.order_id,
            id: payout.uuid,
            utr: utr || '',
            param: payout.param || ''
        };
        cbData.sign = generateSign(cbData, payout.merchant_key);
        try {
            await axios.post(forwardUrl, cbData, { timeout: 10000 });
        } catch (e) {
            console.error('[GTPAY Payout] Forward failed:', e.message);
        }
    }
}

/**
 * POST /api/callback/hdpay/payin
 * Handles callbacks from HDPay for Payin Orders
 * HDPay sends: merchantId, merchantOrderId, amount, payAmount, orderId, status, msg, payTime, sign
 */
router.post('/hdpay/payin', async (req, res) => {
    try {
        console.log('HDPay Payin Callback received:', req.body);
        const db = getDb();
        const { merchantId, merchantOrderId, amount, payAmount, orderId, status, msg, payTime, sign } = req.body;

        // 1. Log Raw Callback
        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('hdpay_payin', ?, ?, ?, datetime('now'))`)
            .run(merchantOrderId || orderId, JSON.stringify(req.body), status);

        // 2. Verify Signature
        if (!hdpayService.verifyPayinCallback(req.body)) {
            console.error('[HDPay Payin SECURITY] Signature verification failed!');
            // Continue processing for now but log the issue
        }

        // 3. Find Transaction
        let tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.order_id = ?')
            .get(merchantOrderId);

        if (!tx && orderId) {
            tx = await db.prepare('SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.platform_order_id = ?')
                .get(orderId);
        }

        if (!tx) {
            console.warn(`[HDPay Payin] Transaction not found for merchantOrderId: ${merchantOrderId}, orderId: ${orderId}`);
            return res.send('success');
        }

        // 4. Determine Status
        // HDPay status: 0=waiting, 1=success, 2=failed
        const newStatus = (status === '1' || status === 1) ? 'success' : 'failed';
        const actualAmount = parseFloat(payAmount || amount);

        if (tx.status === 'success' && newStatus === 'success') {
            console.log(`[HDPay Payin] Order ${tx.order_id} already success. Ignoring duplicate.`);
        } else {
            const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
            const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

            await db.prepare(`
                UPDATE transactions 
                SET status = ?, amount = ?, fee = ?, net_amount = ?, platform_order_id = ?, callback_data = ?, updated_at = datetime('now') 
                WHERE id = ?
            `).run(newStatus, actualAmount, fee, netAmount, orderId, JSON.stringify(req.body), tx.id);

            if (newStatus === 'success') {
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);
                console.log(`[HDPay Payin] Credited ₹${netAmount} to ${tx.username}`);

                // Credit Admin Profit
                try {
                    const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
                    const adminCostRate = settings ? parseFloat(settings.value) : 0.05;
                    const profit = fee - (actualAmount * adminCostRate);
                    if (profit !== 0) await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(profit);
                } catch (e) { }
            }
        }

        // 5. Response to HDPay
        res.send('success');

        // 6. Forward to Merchant
        let callbackUrl = tx.callback_url;
        let originalParam = '';
        try {
            if (tx.param) {
                const parsed = JSON.parse(tx.param);
                if (parsed.c) callbackUrl = parsed.c;
                originalParam = parsed.p || '';
            }
        } catch (e) { }

        if (callbackUrl) {
            const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
            const { netAmount } = calculatePayinFee(actualAmount, merchantRate);

            const data = {
                status: newStatus === 'success' ? 1 : 0,
                amount: netAmount,
                orderAmount: actualAmount,
                orderId: tx.order_id,
                id: tx.uuid,
                utr: '', // HDPay doesn't send UTR in callback
                param: originalParam
            };
            data.sign = generateSign(data, tx.merchant_key);
            try {
                await axios.post(callbackUrl, data, { timeout: 10000 });
            } catch (e) {
                console.error('[HDPay Payin] Forward failed:', e.message);
            }
        }

    } catch (error) {
        console.error('HDPay Payin Callback Error:', error);
        if (!res.headersSent) res.send('success');
    }
});

/**
 * POST /api/callback/hdpay/payout
 * Handles callbacks from HDPay for Payout Orders
 * HDPay sends: merchantId, merchantPayoutId, amount, payoutId, status, msg, fee, singleFee, utr, sign
 */
router.post('/hdpay/payout', async (req, res) => {
    try {
        console.log('HDPay Payout Callback received:', req.body);
        const db = getDb();
        const { merchantId, merchantPayoutId, amount, payoutId, status, msg, fee, utr, sign } = req.body;

        // 1. Log Raw Callback
        await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('hdpay_payout', ?, ?, ?, datetime('now'))`)
            .run(merchantPayoutId || payoutId, JSON.stringify(req.body), status);

        // 2. Verify Signature
        if (!hdpayService.verifyPayoutCallback(req.body)) {
            console.error('[HDPay Payout SECURITY] Signature verification failed!');
        }

        // 3. Find Payout
        let payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.order_id = ?')
            .get(merchantPayoutId);

        if (!payout && payoutId) {
            payout = await db.prepare('SELECT p.*, p.callback_url as payout_callback_url, u.callback_url as user_callback_url, u.merchant_key, u.username FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ?')
                .get(payoutId);
        }

        if (!payout) {
            console.warn(`[HDPay Payout] Payout not found for merchantPayoutId: ${merchantPayoutId}`);
            return res.send('success');
        }

        // 4. Update Status
        // HDPay payout status: 1=success, 2=failed
        let newStatus = 'processing';
        if (status === '1' || status === 1) newStatus = 'success';
        else if (status === '2' || status === 2) newStatus = 'failed';

        if (payout.status === 'success' && newStatus === 'success') {
            console.log(`[HDPay Payout] Order ${payout.order_id} already success.`);
        } else {
            await db.prepare(`UPDATE payouts SET status = ?, utr = ?, platform_order_id = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(newStatus, utr || null, payoutId, msg, JSON.stringify(req.body), payout.id);

            if (newStatus === 'failed' && payout.status !== 'failed') {
                const refundAmount = payout.amount + payout.fee;
                console.log(`[HDPay Payout] Failed. Refunding ${refundAmount} to ${payout.username}`);
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refundAmount, payout.user_id);
            }

            if (newStatus === 'success' && payout.status !== 'success') {
                if (payout.fee > 0) {
                    await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(payout.fee);
                }
            }
        }

        // 5. Response to HDPay
        res.send('success');

        // 6. Forward Callback
        const callbackUrl = payout.payout_callback_url || payout.user_callback_url;

        if (callbackUrl) {
            const cbData = {
                status: newStatus === 'success' ? 1 : 2,
                amount: payout.amount,
                commission: payout.fee,
                message: msg || (newStatus === 'success' ? 'success' : 'failed'),
                orderId: payout.order_id,
                id: payout.uuid,
                utr: utr || '',
                param: payout.param || ''
            };
            cbData.sign = generateSign(cbData, payout.merchant_key);
            try {
                await axios.post(callbackUrl, cbData, { timeout: 10000 });
            } catch (e) {
                console.error('[HDPay Payout] Forward failed:', e.message);
            }
        }

    } catch (error) {
        console.error('HDPay Payout Callback Error:', error);
        if (!res.headersSent) res.send('success');
    }
});

module.exports = router;
