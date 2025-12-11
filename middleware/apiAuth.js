const { getDb } = require('../config/database');
const { verifySign } = require('../utils/signature');

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
        if (!verifySign(req.body, user.merchant_key)) {
            return res.status(401).json({ code: 0, msg: 'Invalid signature' });
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
