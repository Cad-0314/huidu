const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'huidu_secret_key';

/**
 * Authenticate JWT token from Authorization header
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ code: 0, msg: 'No token provided' });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(decoded.userId, 'active');

        if (!user) {
            return res.status(401).json({ code: 0, msg: 'User not found or suspended' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ code: 0, msg: 'Invalid token' });
    }
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ code: 0, msg: 'Admin access required' });
    }
    next();
}

/**
 * Generate JWT token
 */
function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = {
    authenticate,
    requireAdmin,
    generateToken,
    JWT_SECRET
};
