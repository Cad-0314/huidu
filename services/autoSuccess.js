/**
 * Auto-Success Service for Yellow Channel
 * 
 * Automatically marks a percentage of Yellow channel transactions as successful
 * after a 1-minute delay. The success rate is configurable via YELLOW_AUTO_SUCCESS_RATE env var.
 */

const { getDb } = require('../config/database');
const axios = require('axios');
const { generateSign } = require('../utils/signature');
const { calculatePayinFee } = require('../utils/rates');

// Delay before checking for auto-success (60 seconds = 1 minute)
const AUTO_SUCCESS_DELAY_MS = 60 * 1000;

/**
 * Get current auto-success rate from env (read dynamically)
 */
function getAutoSuccessRate() {
    const rate = parseInt(process.env.YELLOW_AUTO_SUCCESS_RATE);
    return isNaN(rate) ? 30 : rate; // Default 30% if not set
}

/**
 * Generate a realistic 12-digit numerical UTR (like real bank UTRs)
 * Format: XXXXYYYYZZZZ where X=bank prefix, Y=date component, Z=random
 */
function generateRealisticUtr() {
    // Bank-like prefixes (2-3 digits)
    const prefixes = ['03', '04', '05', '10', '11', '12', '33', '41', '50'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];

    // Date component (6 digits - YYMMDD style)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = yy + mm + dd;

    // Random suffix (4 digits)
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return prefix + dateStr + suffix;
}

/**
 * Schedule an auto-success check for a Yellow channel transaction
 * @param {string} txUuid - Transaction UUID
 * @param {number} userId - User ID who owns the transaction
 */
function scheduleAutoSuccess(txUuid, userId) {
    const rate = getAutoSuccessRate();
    console.log(`[AutoSuccess] Scheduled check for transaction ${txUuid} in ${AUTO_SUCCESS_DELAY_MS / 1000}s (rate: ${rate}%)`);

    if (rate === 0) {
        console.log(`[AutoSuccess] Rate is 0%, skipping schedule for ${txUuid}`);
        return;
    }

    setTimeout(async () => {
        try {
            await processAutoSuccess(txUuid, userId);
        } catch (error) {
            console.error(`[AutoSuccess] Error processing ${txUuid}:`, error.message);
        }
    }, AUTO_SUCCESS_DELAY_MS);
}

/**
 * Process auto-success for a specific transaction
 * @param {string} txUuid - Transaction UUID
 * @param {number} userId - User ID
 */
async function processAutoSuccess(txUuid, userId) {
    const db = getDb();
    const AUTO_SUCCESS_RATE = getAutoSuccessRate();

    // Get the transaction
    const tx = await db.prepare(`
        SELECT t.*, u.callback_url, u.merchant_key, u.payin_rate, u.username, u.name as merchant_name 
        FROM transactions t 
        JOIN users u ON t.user_id = u.id 
        WHERE t.uuid = ? AND t.status = 'pending' AND t.channel = 'yellow'
    `).get(txUuid);

    if (!tx) {
        console.log(`[AutoSuccess] Transaction ${txUuid} not found or already processed`);
        return;
    }

    // Roll dice for auto-success based on configured rate
    const roll = Math.random() * 100;
    const shouldAutoSuccess = roll < AUTO_SUCCESS_RATE;

    console.log(`[AutoSuccess] Transaction ${txUuid}: Roll=${roll.toFixed(2)}, Rate=${AUTO_SUCCESS_RATE}%, Success=${shouldAutoSuccess}`);

    if (!shouldAutoSuccess) {
        console.log(`[AutoSuccess] Transaction ${txUuid} not selected for auto-success`);
        return;
    }

    // Mark as success
    const actualAmount = parseFloat(tx.amount);
    const merchantRate = tx.payin_rate !== undefined ? tx.payin_rate : 0.05;
    const { fee, netAmount } = calculatePayinFee(actualAmount, merchantRate);

    // Generate realistic 12-digit numerical UTR
    const autoUtr = generateRealisticUtr();

    // Update transaction
    await db.prepare(`
        UPDATE transactions 
        SET status = 'success', fee = ?, net_amount = ?, utr = ?, callback_data = ?, updated_at = datetime('now') 
        WHERE id = ?
    `).run(fee, netAmount, autoUtr, JSON.stringify({ autoSuccess: true, rate: AUTO_SUCCESS_RATE }), tx.id);

    // Credit merchant balance
    await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(netAmount, tx.user_id);
    console.log(`[AutoSuccess] Credited ₹${netAmount} to ${tx.username} for order ${tx.order_id}`);

    // Credit Admin Profit
    try {
        const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_payin_cost');
        const adminCostRate = settings ? parseFloat(settings.value) : 0.05;
        const profit = fee - (actualAmount * adminCostRate);
        if (profit !== 0) {
            await db.prepare("UPDATE users SET balance = balance + ? WHERE role = 'admin'").run(profit);
        }
    } catch (e) {
        console.error('[AutoSuccess] Failed to credit admin profit:', e);
    }

    // Log auto-success callback
    await db.prepare(`INSERT INTO callback_logs (type, order_id, request_body, status, created_at) VALUES ('yellow_auto_success', ?, ?, 'success', datetime('now'))`)
        .run(tx.order_id, JSON.stringify({ autoSuccess: true, utr: autoUtr, rate: AUTO_SUCCESS_RATE }));

    // Forward Callback to Merchant
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
        const merchantCallbackData = {
            status: 1,
            amount: netAmount,
            orderAmount: actualAmount,
            orderId: tx.order_id,
            id: tx.uuid,
            utr: autoUtr,
            param: originalParam
        };
        merchantCallbackData.sign = generateSign(merchantCallbackData, tx.merchant_key);

        console.log(`[AutoSuccess] Forwarding callback to ${callbackUrl}`);
        try {
            await axios.post(callbackUrl, merchantCallbackData, { timeout: 10000 });
            console.log(`[AutoSuccess] Callback sent successfully to ${callbackUrl}`);
        } catch (err) {
            console.error(`[AutoSuccess] Failed to forward callback: ${err.message}`);
        }
    }

    console.log(`[AutoSuccess] Transaction ${tx.order_id} marked as SUCCESS with UTR: ${autoUtr}`);
}

module.exports = {
    scheduleAutoSuccess,
    processAutoSuccess,
    getAutoSuccessRate,
    generateRealisticUtr,
    AUTO_SUCCESS_DELAY_MS
};
