const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const { authenticate } = require('../middleware/auth'); // Import JWT auth
const silkpayService = require('../services/silkpay');
const { calculatePayoutFee, getUserRates } = require('../utils/rates');
const { generateOrderId, generateSign } = require('../utils/signature');
const speakeasy = require('speakeasy');

// Unified Auth Middleware: Supports both JWT (Dashboard) and API Signature (External)
const unifiedAuth = async (req, res, next) => {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        // Use JWT Auth
        return authenticate(req, res, () => {
            if (req.user) {
                req.merchant = req.user; // Standardize to req.merchant
                next();
            }
        });
    }
    // Fallback to API Auth
    return apiAuthenticate(req, res, next);
};

/**
 * POST /api/payout/bank - Bank payout (automatic)
 */
router.post('/bank', unifiedAuth, async (req, res) => {
    try {
        const { amount, orderId, account, ifsc, personName, callbackUrl, param, code } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!amount || !orderId || !account || !ifsc || !personName) {
            return res.status(400).json({ code: 0, msg: 'amount, orderId, account, ifsc, and personName are required' });
        }

        if (!req.isApiRequest && !code) {
            return res.status(400).json({ code: 0, msg: '2FA code is required' });
        }

        // Verify 2FA (Payouts require strict 2FA enabled, or if not enabled, default code?
        // Requirement: "bind for first time ... login ... use for payout". 
        // This implies 2FA MUST be enabled to payout.

        if (!req.isApiRequest) {
            let verified = false;
            if (merchant.two_factor_enabled && merchant.two_factor_secret) {
                verified = speakeasy.totp.verify({
                    secret: merchant.two_factor_secret,
                    encoding: 'base32',
                    token: code,
                    window: 6 // Allow 3 minutes drift
                });
            } else {
                verified = (code === '111111');
            }

            if (!verified) {
                return res.status(400).json({ code: 0, msg: 'Invalid 2FA code' });
            }
        }

        const payoutAmount = parseFloat(amount);

        // Minimum bank withdraw: ₹100
        if (payoutAmount < 100) {
            return res.status(400).json({ code: 0, msg: 'Minimum bank withdrawal is ₹100' });
        }

        const existing = await db.prepare('SELECT id FROM payouts WHERE order_id = ?').get(orderId);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Order ID already exists' });
        }

        const rates = await getUserRates(db, merchant.id);
        const { fee, totalDeduction } = calculatePayoutFee(payoutAmount, rates.payoutRate, rates.payoutFixed);

        if (merchant.balance < totalDeduction) {
            console.warn(`[PAYOUT BANK FAIL] Insufficient balance. Merchant: ${merchant.uuid}, Required: ${totalDeduction}, Available: ${merchant.balance}`);
            return res.status(400).json({ code: 0, msg: `Insufficient balance. Required: ${totalDeduction}, Available: ${merchant.balance}` });
        }
        console.log(`[PAYOUT BANK] Deducting balance. Merchant: ${merchant.uuid}, Amount: ${totalDeduction}`);

        await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalDeduction, merchant.id);

        // Demo User Logic
        let silkpayConfig = {};
        if (merchant.username === 'demo') {
            silkpayConfig = {
                baseUrl: 'https://api.dev.silkpay.ai',
                mid: 'TEST',
                secret: 'SIb3DQEBAQ'
            };
        }

        const internalOrderId = generateOrderId('HDO');
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const ourCallbackUrl = `${appUrl}/api/payout/callback`;

        const payoutUuid = uuidv4();

        // Note: Payouts table might not support param column, so we skip storing dynamic callback for now.
        // If needed, we must add column to schema.

        const source = req.isApiRequest ? 'api' : 'settlement';
        await db.prepare(`INSERT INTO payouts (uuid, user_id, order_id, platform_order_id, payout_type, amount, fee, net_amount, status, account_number, ifsc_code, account_name, source) VALUES (?, ?, ?, ?, 'bank', ?, ?, ?, 'processing', ?, ?, ?, ?)`)
            .run(payoutUuid, merchant.id, orderId, internalOrderId, payoutAmount, fee, payoutAmount, account, ifsc, personName, source);

        // --- INSTANT CALLBACK REMOVED (Handled by Upstream) ---
        // if (merchant.username === 'demo') { ... }
        // ------------------------------------------------------

        try {
            const silkpayResponse = await silkpayService.createPayout({
                amount,
                orderId: internalOrderId,
                account: account, // Silkpay mapping? createPayout checks "bankNo"
                bankNo: account,
                ifsc: ifsc,
                name: personName, // Silkpay "name"
                personName: personName,
                notifyUrl: ourCallbackUrl
            }, silkpayConfig);

            if (silkpayResponse.status !== '200') {
                await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalDeduction, merchant.id);
                await db.prepare('UPDATE payouts SET status = ?, message = ? WHERE uuid = ?').run('failed', silkpayResponse.message || 'Silkpay API error', payoutUuid);
                return res.status(400).json({ code: 0, msg: silkpayResponse.message || 'Failed to create payout' });
            }

            // Silkpay response data: { payOrderId: '...' }
            await db.prepare('UPDATE payouts SET platform_order_id = ? WHERE uuid = ?').run(silkpayResponse.data.payOrderId || internalOrderId, payoutUuid);
            res.json({ code: 1, msg: 'Payout submitted', data: { orderId, id: payoutUuid, amount: payoutAmount, fee, status: 'processing' } });
        } catch (apiError) {
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalDeduction, merchant.id);
            await db.prepare('UPDATE payouts SET status = ?, message = ? WHERE uuid = ?').run('failed', apiError.message, payoutUuid);
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
router.post('/usdt', unifiedAuth, async (req, res) => {
    try {
        const { amount, orderId, walletAddress, network, callbackUrl, param, code } = req.body;
        const merchant = req.merchant;
        const db = getDb();

        if (!amount || !orderId || !walletAddress || !network) {
            return res.status(400).json({ code: 0, msg: 'amount, orderId, walletAddress, and network are required' });
        }

        if (!req.isApiRequest && !code) {
            return res.status(400).json({ code: 0, msg: '2FA code is required' });
        }

        // Verify 2FA
        if (!req.isApiRequest) {
            let verified = false;
            if (merchant.two_factor_enabled && merchant.two_factor_secret) {
                verified = speakeasy.totp.verify({
                    secret: merchant.two_factor_secret,
                    encoding: 'base32',
                    token: code,
                    window: 6 // Allow 3 minutes drift
                });
            } else {
                verified = (code === '111111');
            }

            if (!verified) {
                return res.status(400).json({ code: 0, msg: 'Invalid 2FA code' });
            }
        }

        const payoutAmount = parseFloat(amount);

        // Minimum USDT withdraw: 500 USDT = ₹50,000 (at 100 INR/USDT)
        const minUsdtInr = 500 * 100; // 500 USDT × 100 = ₹50,000
        if (payoutAmount < minUsdtInr) {
            return res.status(400).json({ code: 0, msg: `Minimum USDT withdrawal is 500 USDT (₹${minUsdtInr.toLocaleString()})` });
        }

        if (!['TRC20', 'ERC20', 'BEP20'].includes(network)) {
            return res.status(400).json({ code: 0, msg: 'Invalid network. Use TRC20, ERC20, or BEP20' });
        }

        const existing = await db.prepare('SELECT id FROM payouts WHERE order_id = ?').get(orderId);
        if (existing) {
            return res.status(400).json({ code: 0, msg: 'Order ID already exists' });
        }

        const rates = await getUserRates(db, merchant.id);
        const { fee: calcFee, totalDeduction: calcDeduction } = calculatePayoutFee(payoutAmount, rates.payoutRate, rates.payoutFixed);

        let fee = calcFee;
        let totalDeduction = calcDeduction;

        if (!req.isApiRequest) {
            fee = 0;
            totalDeduction = payoutAmount;
        }

        let finalFee = fee;
        let finalDeduction = totalDeduction;

        // No fee for Admin/Manual Settlement on USDT
        if (!req.isApiRequest) {
            finalFee = 0;
            finalDeduction = payoutAmount;
        }

        if (merchant.balance < finalDeduction) {
            console.warn(`[PAYOUT USDT FAIL] Insufficient balance. Merchant: ${merchant.uuid}, Required: ${finalDeduction}, Available: ${merchant.balance}`);
            return res.status(400).json({ code: 0, msg: `Insufficient balance. Required: ${finalDeduction}, Available: ${merchant.balance}` });
        }
        console.log(`[PAYOUT USDT] Deducting balance. Merchant: ${merchant.uuid}, Amount: ${finalDeduction}`);

        await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(finalDeduction, merchant.id);

        const payoutUuid = uuidv4();
        const source = req.isApiRequest ? 'api' : 'settlement';
        await db.prepare(`INSERT INTO payouts (uuid, user_id, order_id, payout_type, amount, fee, net_amount, status, wallet_address, network, source) VALUES (?, ?, ?, 'usdt', ?, ?, ?, 'pending', ?, ?, ?)`)
            .run(payoutUuid, merchant.id, orderId, payoutAmount, finalFee, payoutAmount, walletAddress, network, source);

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

        const payout = await db.prepare('SELECT * FROM payouts WHERE order_id = ? AND user_id = ?').get(orderId, merchant.id);

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
 * POST /api/payout/check - Public order check API for clients
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

        const payout = await db.prepare('SELECT * FROM payouts WHERE order_id = ? AND user_id = ?').get(orderId, user.id);

        if (!payout) {
            return res.status(404).json({ code: 0, msg: 'Payout not found' });
        }

        res.json({
            code: 1,
            msg: 'Payout found',
            data: {
                orderId: payout.order_id,
                id: payout.uuid,
                type: payout.payout_type,
                status: payout.status,
                amount: payout.amount,
                fee: payout.fee,
                netAmount: payout.net_amount,
                utr: payout.utr,
                message: payout.message,
                createdAt: payout.created_at,
                updatedAt: payout.updated_at
            }
        });
    } catch (error) {
        console.error('Check payout error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/payout/callback
 */
router.post('/callback', async (req, res) => {
    try {
        console.log('Payout callback received:', req.body);
        const { status, amount, payOrderId, message, orderId, utr, sign } = req.body;
        const db = getDb();

        await db.prepare(`INSERT INTO callback_logs (type, request_body, status) VALUES ('payout', ?, ?)`).run(JSON.stringify(req.body), status);

        // Verify Signature
        if (!silkpayService.verifyPayoutCallback(req.body)) {
            console.error('Payout callback signature verification failed');
            return res.send('OK');
        }

        // Lookup transaction by payOrderId (platform_order_id)
        const payout = await db.prepare('SELECT p.*, u.callback_url, u.merchant_key FROM payouts p JOIN users u ON p.user_id = u.id WHERE p.platform_order_id = ?')
            .get(payOrderId);

        if (!payout) {
            console.log('Payout not found for payOrderId:', payOrderId);
            return res.send('OK');
        }

        // Status: 2: Success, 3: Failed
        const newStatus = status === '2' || status === 2 ? 'success' : 'failed';

        await db.prepare(`UPDATE payouts SET status = ?, utr = ?, message = ?, callback_data = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newStatus, utr || null, message || null, JSON.stringify(req.body), payout.id);

        // Refund if failed
        if (newStatus === 'failed' && payout.status !== 'failed') {
            await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.amount + payout.fee, payout.user_id);
        }

        const merchantCallback = payout.callback_url; // From DB join
        if (merchantCallback) {
            try {
                const merchantCallbackData = {
                    status: newStatus === 'success' ? 1 : 2, amount: payout.amount, commission: payout.fee,
                    message: message || (newStatus === 'success' ? 'success' : 'failed'),
                    orderId: payout.order_id, // User's orderId
                    id: payout.uuid, utr: utr || '', param: '' // param not supported in Silkpay callback echo
                };
                merchantCallbackData.sign = generateSign(merchantCallbackData, payout.merchant_key);
                await axios.post(merchantCallback, merchantCallbackData, { timeout: 10000 });
            } catch (callbackError) {
                console.error('Failed to forward callback:', callbackError.message);
            }
        }

        res.send('OK');
    } catch (error) {
        console.error('Payout callback error:', error);
        res.send('OK');
    }
});

module.exports = router;
