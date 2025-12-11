const { getDb } = require('../config/database');
const { verifySign, generateSign } = require('../utils/signature');

/**
 * Authenticate API calls using merchant key and signature
 * Similar to how Payable API authenticates requests
 */
async function apiAuthenticate(req, res, next) {
    const { userId, sign } = req.body;

    if (!userId || !sign) {
        return res.status(400).json({ code: 0, msg: 'Missing userId or sign' });
    }

    const db = getDb();
    // Find user by UUID (external userId)
    try {
        const user = await db.prepare('SELECT * FROM users WHERE uuid = ? AND status = ?').get(userId, 'active');

        if (!user) {
            return res.status(401).json({ code: 0, msg: 'Invalid userId or user suspended' });
        }

        // Verify signature using merchant_key as secret
        const calculatedSign = generateSign(req.body, user.merchant_key);
        if (req.body.sign.toUpperCase() !== calculatedSign) {
            console.error('---------------------------------------------------');
            console.error('[API SIGN ERROR] Signature Mismatch');
            console.error('Merchant UUID:', userId);
            console.error('Merchant Key:', user.merchant_key);
            console.error('Request Body:', JSON.stringify(req.body));
            console.error('Received Sign:', req.body.sign);
            console.error('Calculated Sign:', calculatedSign);
            console.error('---------------------------------------------------');
            return res.status(401).json({
                code: 0,
                msg: 'Invalid signature',
                debug: { received: req.body.sign, calculated: calculatedSign }
            });
        }

        req.merchant = user;
        next();
    } catch (error) {
        console.error('API Auth Error:', error);
        return res.status(500).json({ code: 0, msg: 'Server error during auth' });
    }
}

module.exports = {
    apiAuthenticate
};
