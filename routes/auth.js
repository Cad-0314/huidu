const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { generateToken } = require('../middleware/auth');
const { generateMerchantKey } = require('../utils/signature');

/**
 * POST /api/auth/login
 * Login for admin and merchants
 */
router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ code: 0, msg: 'Username and password required' });
        }

        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        if (!user) {
            return res.status(401).json({ code: 0, msg: 'Invalid credentials' });
        }

        if (user.status !== 'active') {
            return res.status(401).json({ code: 0, msg: 'Account suspended' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ code: 0, msg: 'Invalid credentials' });
        }

        const token = generateToken(user.id);

        res.json({
            code: 1,
            msg: 'Login successful',
            data: {
                token,
                user: {
                    id: user.uuid,
                    username: user.username,
                    name: user.name,
                    role: user.role,
                    balance: user.balance
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * GET /api/auth/profile
 * Get current user profile
 */
router.get('/profile', authenticate, (req, res) => {
    try {
        const user = req.user;
        res.json({
            code: 1,
            data: {
                id: user.uuid,
                username: user.username,
                name: user.name,
                role: user.role,
                balance: user.balance,
                merchantKey: user.merchant_key,
                callbackUrl: user.callback_url,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * PUT /api/auth/profile
 * Update profile (callback URL, name)
 */
router.put('/profile', authenticate, (req, res) => {
    try {
        const { name, callbackUrl } = req.body;
        const user = req.user;
        const db = getDb();

        const updates = [];
        const params = [];

        if (name) {
            updates.push('name = ?');
            params.push(name);
        }
        if (callbackUrl !== undefined) {
            updates.push('callback_url = ?');
            params.push(callbackUrl);
        }

        if (updates.length > 0) {
            updates.push("updated_at = datetime('now')");
            params.push(user.id);

            db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

        res.json({
            code: 1,
            msg: 'Profile updated',
            data: {
                id: updatedUser.uuid,
                username: updatedUser.username,
                name: updatedUser.name,
                callbackUrl: updatedUser.callback_url
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/regenerate-key
 * Regenerate merchant API key
 */
router.post('/regenerate-key', authenticate, (req, res) => {
    try {
        const user = req.user;
        const newKey = generateMerchantKey();
        const db = getDb();

        db.prepare("UPDATE users SET merchant_key = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newKey, user.id);

        res.json({
            code: 1,
            msg: 'API key regenerated',
            data: {
                merchantKey: newKey
            }
        });
    } catch (error) {
        console.error('Regenerate key error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/change-password
 * Change password
 */
router.post('/change-password', authenticate, (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = req.user;
        const db = getDb();

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ code: 0, msg: 'Current and new password required' });
        }

        const validPassword = bcrypt.compareSync(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ code: 0, msg: 'Current password is incorrect' });
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?")
            .run(hashedPassword, user.id);

        res.json({ code: 1, msg: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

module.exports = router;
