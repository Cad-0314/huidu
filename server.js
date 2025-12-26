require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ERROR_LOG_FILE = path.join(__dirname, 'error.txt');

// Error logging function
function logError(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${context}\n${error.stack || error.message || error}\n\n`;

    try {
        fs.appendFileSync(ERROR_LOG_FILE, errorMessage);
    } catch (e) {
        console.error('Failed to write to error log:', e);
    }
}

// Middleware
app.use(cors());
app.use(require('compression')());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check (before DB init)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
// Middleware to ensure DB is initialized
app.use(async (req, res, next) => {
    try {
        const { getDb, initDatabase } = require('./config/database');
        try {
            getDb();
        } catch (e) {
            await initDatabase();
        }
        next();
    } catch (err) {
        console.error('DB Init Error:', err);
        res.status(500).json({ error: 'Database initialization failed' });
    }
});

// Helper to initialize components (Bot, etc.) - executed once
let initialized = false;
async function initApp() {
    if (initialized) return;
    initialized = true;

    // Initialize Database (also happens in middleware strictly speaking, but good to kick off)
    const { initDatabase } = require('./config/database');
    await initDatabase();

    // Initialize Bot (Only if NOT Vercel, or need webhook setup)
    // Vercel serverless functions have short timeouts, polling (initBot) blocks or fails.
    if (!process.env.VERCEL) {
        const { initBot } = require('./services/telegram');
        initBot();
    }
}

// Routes Definition (Synchronous)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/merchant', require('./routes/merchant'));
app.use('/api/payin', require('./routes/payin'));
app.use('/api/payout', require('./routes/payout'));
app.use('/api/balance', require('./routes/balance'));
app.use('/api/callback', require('./routes/callback'));

// Bot Webhook (For Vercel)
app.post('/api/telegram/webhook', async (req, res) => {
    const { handleUpdate } = require('./services/telegram');
    await handleUpdate(req, res);
});

// Payment Page - Public Route
app.get('/pay/:orderId', async (req, res) => {
    try {
        const { getDb } = require('./config/database');
        const db = getDb();
        const orderId = req.params.orderId;

        const tx = await db.prepare('SELECT * FROM transactions WHERE platform_order_id = ? OR order_id = ?').get(orderId, orderId);

        if (!tx || tx.type !== 'payin') {
            return res.status(404).send('Payment not found');
        }

        if (tx.status === 'success') {
            return res.send('<h1>Payment already completed</h1>');
        }

        // Check Expiration (20 minutes)
        // Check Expiration (20 minutes)
        const createdAt = new Date(tx.created_at + 'Z'); // Ensure UTC parsing
        const now = new Date();
        const diffMs = now - createdAt; // diff in ms
        const twentyMinsMs = 20 * 60 * 1000;

        let deepLinks = {};
        let skipUrl = '';
        try {
            if (tx.param) {
                const parsed = JSON.parse(tx.param);
                if (parsed.deepLinks) {
                    deepLinks = parsed.deepLinks;
                }
                if (parsed.s) {
                    skipUrl = parsed.s;
                }
            }
        } catch (e) {
            console.error('Failed to parse params:', e);
        }

        if (diffMs > twentyMinsMs) {
            // Expired
            const returnLink = skipUrl || '#';
            const returnAttr = skipUrl ? `href="${skipUrl}"` : 'href="#" onclick="history.back()"';

            return res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Payment Expired</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f7fa; text-align: center; padding: 20px; }
                        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
                        h2 { color: #e53e3e; margin-bottom: 16px; }
                        p { color: #4a5568; margin-bottom: 24px; line-height: 1.5; }
                        .btn { display: inline-block; padding: 12px 24px; background: #3182ce; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; transition: background 0.2s; }
                        .btn:hover { background: #2c5282; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Details Expired</h2>
                        <p>Time has expired if you have paid please wait it will sucess soon</p>
                        <a ${returnAttr} class="btn">Return</a>
                    </div>
                </body>
                </html>
             `);
        }

        // --- Select Template based on Channel ---
        const isGtpay = (tx.channel === 'gtpay');

        // GTPAY: Redirect directly to payment URL (no iframe)
        if (isGtpay && tx.payment_url) {
            return res.redirect(tx.payment_url);
        }

        // All channels (Silkpay, F2PAY, HDPay) use the same pay.html with deeplinks
        const templateFile = 'pay.html';

        let html = fs.readFileSync(path.join(__dirname, 'public', templateFile), 'utf8');

        html = html.replace(/\{\{AMOUNT\}\}/g, parseFloat(tx.amount).toFixed(2));
        html = html.replace(/\{\{ORDER_ID\}\}/g, tx.order_id);
        html = html.replace(/\{\{UUID\}\}/g, tx.uuid);
        html = html.replace(/\{\{DATE\}\}/g, new Date(tx.created_at).toLocaleDateString());
        html = html.replace(/\{\{PAYMENT_URL\}\}/g, tx.payment_url);

        html = html.replace('{{DEEPLINK_PHONEPE}}', deepLinks.upi_phonepe || '');
        html = html.replace('{{DEEPLINK_PAYTM}}', deepLinks.upi_paytm || '');

        // Generate Google Pay link if not present
        let gpayLink = deepLinks.upi_gpay || '';
        if (!gpayLink) {
            try {
                // Try to get params from specific deep links or main payment URL
                const sourceUrl = deepLinks.upi_scan || deepLinks.upi_phonepe || tx.payment_url || '';
                const urlObj = new URL(sourceUrl.startsWith('http') ? sourceUrl : sourceUrl.replace(/^[a-zA-Z]+:\/\//, 'http://'));
                const params = new URLSearchParams(urlObj.search);

                const pa = params.get('pa');
                const pn = params.get('pn');
                const tn = params.get('tn');
                const am = params.get('am');
                const cu = params.get('cu') || 'INR';

                if (pa && am) {
                    gpayLink = `tez://upi/pay?pa=${pa}&pn=${encodeURIComponent(pn || '')}&tn=${encodeURIComponent(tn || '')}&am=${am}&cu=${cu}`;
                }
            } catch (err) {
                console.error('Error generating GPay link:', err);
            }
        }
        html = html.replace('{{DEEPLINK_GPAY}}', gpayLink);

        html = html.replace('{{DEEPLINK_UPI}}', deepLinks.upi_scan || tx.payment_url || '');
        html = html.replace('{{SKIP_URL}}', skipUrl || '');

        res.send(html);
    } catch (error) {
        console.error('Payment page error:', error);
        res.status(500).send('Server Error');
    }
});

// Serve API Docs
app.get('/apidocs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'apidocs.html'));
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Error handling
app.use((err, req, res, next) => {
    const context = `Route: ${req.method} ${req.path}`;
    logError(err, context);
    console.error('Unhandled error:', err);
    res.status(500).json({ code: 0, msg: 'Internal server error' });
});

// Start Server (Only for local/persistent envs)
if (require.main === module) {
    initApp().then(() => {
        app.listen(PORT, () => {
            console.log(`
    ╔═══════════════════════════════════════════════════╗
    ║     VSPAY Payment Gateway                        ║
    ║     Server running on http://localhost:${PORT}      ║
    ╠═══════════════════════════════════════════════════╣
    ║  Default Admin: admin / admin123                  ║
    ╚═══════════════════════════════════════════════════╝
            `);
        });
    });
} else {
    // For Vercel/Serverless
    initApp();
}

module.exports = app;
