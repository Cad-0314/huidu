/**
 * Rate calculation utilities for VSPAY Payment Gateway
 * Pay-in rate: 5% (we keep 5% commission)
 * Payout rate: 3% + ₹6 per transaction
 */

const DEFAULT_PAYIN_RATE = 0.05;     // 5%
const DEFAULT_PAYOUT_RATE = 0.03;    // 3%
const DEFAULT_PAYOUT_FIXED = 6;       // ₹6

/**
 * Calculate pay-in fees and net amount
 * @param {number} amount - The transaction amount
 * @param {number} rate - Commission rate (default 5%)
 * @returns {object} { fee, netAmount }
 */
function calculatePayinFee(amount, rate = DEFAULT_PAYIN_RATE) {
    const fee = parseFloat((amount * rate).toFixed(2));
    const netAmount = parseFloat((amount - fee).toFixed(2));
    return { fee, netAmount };
}

/**
 * Calculate payout fees and net amount
 * @param {number} amount - The payout amount
 * @param {number} rate - Commission rate (default 3%)
 * @param {number} fixedFee - Fixed fee per transaction (default ₹6)
 * @returns {object} { fee, netAmount, totalDeduction }
 */
function calculatePayoutFee(amount, rate = DEFAULT_PAYOUT_RATE, fixedFee = DEFAULT_PAYOUT_FIXED) {
    const percentageFee = parseFloat((amount * rate).toFixed(2));
    const totalFee = parseFloat((percentageFee + fixedFee).toFixed(2));
    const totalDeduction = parseFloat((amount + totalFee).toFixed(2));
    return {
        fee: totalFee,
        percentageFee,
        fixedFee,
        amount,
        totalDeduction
    };
}

/**
 * Get rates from database settings
 */
function getRatesFromDb(db) {
    const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');

    const payinRate = parseFloat(getSetting.get('payin_rate')?.value || DEFAULT_PAYIN_RATE);
    const payoutRate = parseFloat(getSetting.get('payout_rate')?.value || DEFAULT_PAYOUT_RATE);
    const payoutFixed = parseFloat(getSetting.get('payout_fixed_fee')?.value || DEFAULT_PAYOUT_FIXED);

    return { payinRate, payoutRate, payoutFixed };
}

module.exports = {
    calculatePayinFee,
    calculatePayoutFee,
    getRatesFromDb,
    DEFAULT_PAYIN_RATE,
    DEFAULT_PAYOUT_RATE,
    DEFAULT_PAYOUT_FIXED
};
