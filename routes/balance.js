const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { apiAuthenticate } = require('../middleware/apiAuth');
const { authenticate } = require('../middleware/auth'); // For dashboard access if needed

// Unified Auth Middleware
const unifiedAuth = async (req, res, next) => {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        return authenticate(req, res, () => {
            if (req.user) {
                req.merchant = req.user;
                next();
            }
        });
    }
    return apiAuthenticate(req, res, next);
};

/**
 * POST /api/balance/query
 * Returns the merchant's current balance (local).
 */
router.post('/query', unifiedAuth, async (req, res) => {
    try {
        const merchant = req.merchant;
        const db = getDb();

        // Fetch fresh user data to ensure latest balance
        const user = await db.prepare('SELECT balance, username, merchant_key FROM users WHERE id = ?').get(merchant.id);

        if (!user) {
            return res.status(404).json({ code: 0, msg: 'Merchant not found' });
        }

        // Calculate pending balance (optional, if we track frozen amounts)
        // For now, simple available balance
        const pendingAmount = 0;

        res.json({
            code: 1,
            msg: 'Success',
            data: {
                availableAmount: user.balance,
                pendingAmount: pendingAmount,
                totalAmount: user.balance + pendingAmount
            }
        });
    } catch (error) {
        console.error('Balance query error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

module.exports = router;
