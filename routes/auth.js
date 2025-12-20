const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { generateToken } = require('../middleware/auth');
const { generateMerchantKey } = require('../utils/signature');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const DEFAULT_2FA_CODE = '111111';

/**
 * POST /api/auth/login
 * Login for admin and merchants
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ code: 0, msg: 'Username and password required' });
        }

        const db = getDb();
        const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);

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

        // 2FA Logic
        // Determine 2FA status
        // If 2FA enabled: Require code.
        // If 2FA disabled: Require setup (or default code).
        // For now, prompt frontend to ask for code.

        // We do NOT return the full token yet. We return a temporary state or ask for code.
        // Actually, to keep it simple and stateless (JWT), we can issue a temporary JWT 
        // that is ONLY valid for 2FA verification.

        const tempToken = jwt.sign({
            userId: user.id,
            partial: true,
            twoFactorEnabled: !!user.two_factor_enabled
        }, process.env.JWT_SECRET || 'vspay_secret_key', { expiresIn: '5m' });

        return res.json({
            code: 2,
            msg: '2FA Verification Required',
            require2fa: true,
            isSetup: !!user.two_factor_enabled,
            tempToken
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/verify-2fa
 * Verify 2FA code and issue real token
 */
router.post('/verify-2fa', async (req, res) => {
    try {
        const { tempToken, code } = req.body;

        if (!tempToken || !code) {
            return res.status(400).json({ code: 0, msg: 'Token and code required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(tempToken, process.env.JWT_SECRET || 'vspay_secret_key');
        } catch (e) {
            return res.status(401).json({ code: 0, msg: 'Invalid or expired session' });
        }

        if (!decoded.partial) {
            return res.status(400).json({ code: 0, msg: 'Invalid login flow' });
        }

        const db = getDb();
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);

        if (!user) {
            return res.status(401).json({ code: 0, msg: 'User not found' });
        }

        let verified = false;

        if (user.two_factor_enabled) {
            // Verify against TOTP
            // DEMO Bypass
            if (user.username === 'demo' && code === '111111') {
                verified = true;
            } else {
                verified = speakeasy.totp.verify({
                    secret: user.two_factor_secret,
                    encoding: 'base32',
                    token: code,
                    window: 6 // Allow 3 minutes drift
                });
            }
        } else {
            // Verify against default code
            verified = code === DEFAULT_2FA_CODE;
        }

        if (!verified) {
            return res.status(401).json({ code: 0, msg: 'Invalid 2FA code' });
        }

        // Issue real token
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
                    balance: user.balance,
                    twoFactorEnabled: !!user.two_factor_enabled
                }
            }
        });

    } catch (error) {
        console.error('Verify 2FA error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/2fa/setup
 * Start 2FA setup (Generate secret)
 */
router.post('/2fa/setup', authenticate, async (req, res) => {
    try {
        const user = req.user;
        const db = getDb();

        const secret = speakeasy.generateSecret({
            name: `VSPAY (${user.username})`
        });

        // Store temp secret
        await db.prepare('UPDATE users SET two_factor_temp_secret = ? WHERE id = ?')
            .run(secret.base32, user.id);

        // Generate QR Code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

        res.json({
            code: 1,
            data: {
                secret: secret.base32,
                qrCode: qrCodeUrl
            }
        });
    } catch (error) {
        console.error('2FA Setup error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/2fa/enable
 * Enable 2FA with code
 */
router.post('/2fa/enable', authenticate, async (req, res) => {
    try {
        const { code } = req.body;
        const user = req.user;
        const db = getDb();

        // Fetch fresh user to get temp secret
        const freshUser = await db.prepare('SELECT two_factor_temp_secret FROM users WHERE id = ?').get(user.id);

        if (!freshUser.two_factor_temp_secret) {
            return res.status(400).json({ code: 0, msg: 'Setup not initiated' });
        }

        const verified = speakeasy.totp.verify({
            secret: freshUser.two_factor_temp_secret,
            encoding: 'base32',
            token: code,
            window: 6 // Allow 3 minutes drift
        });

        if (!verified) {
            return res.status(400).json({ code: 0, msg: 'Invalid code' });
        }

        // Enable 2FA
        await db.prepare(`
            UPDATE users 
            SET two_factor_enabled = 1, 
                two_factor_secret = two_factor_temp_secret, 
                two_factor_temp_secret = NULL 
            WHERE id = ?
        `).run(user.id);

        res.json({ code: 1, msg: '2FA Enabled Successfully' });
    } catch (error) {
        console.error('2FA Enable error:', error);
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
                payinRate: user.payin_rate,
                payoutRate: user.payout_rate,
                twoFactorEnabled: !!user.two_factor_enabled,
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
router.put('/profile', authenticate, async (req, res) => {
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

            await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

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
router.post('/regenerate-key', authenticate, async (req, res) => {
    try {
        const user = req.user;
        const newKey = generateMerchantKey();
        const db = getDb();

        await db.prepare("UPDATE users SET merchant_key = ?, updated_at = datetime('now') WHERE id = ?")
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
router.post('/change-password', authenticate, async (req, res) => {
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
        await db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?")
            .run(hashedPassword, user.id);

        res.json({ code: 1, msg: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

/**
 * POST /api/auth/2fa/disable - Disable 2FA
 */
router.post('/2fa/disable', authenticate, async (req, res) => {
    try {
        const user = req.user;
        const db = getDb();

        // Reset 2FA fields
        await db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(user.id);

        res.json({ code: 1, msg: '2FA Disabled' });
    } catch (error) {
        console.error('Disable 2FA error:', error);
        res.status(500).json({ code: 0, msg: 'Server error' });
    }
});

module.exports = router;
