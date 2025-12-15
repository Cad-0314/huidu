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
async function startServer() {
    try {
        // Initialize database
        const { initDatabase } = require('./config/database');
        await initDatabase();

        // Initialize Telegram Bot
        const { initBot } = require('./services/telegram');
        initBot();

        // API Routes
        app.use('/api/auth', require('./routes/auth'));
        app.use('/api/admin', require('./routes/admin'));
        app.use('/api/merchant', require('./routes/merchant'));
        app.use('/api/payin', require('./routes/payin'));
        app.use('/api/payout', require('./routes/payout'));

        // Payment Page - Public Route
        app.get('/pay/:orderId', async (req, res) => {
            try {
                const { getDb } = require('./config/database');
                const db = getDb();
                const orderId = req.params.orderId;

                // Lookup by internal Platform Order ID (internalOrderId) OR Merchant Order ID (order_id)
                // Silkpay uses internalOrderId (HDP...) so the local link should probably use that or the merchant one.
                // Let's support both if possible or just order_id.
                // If the link uses the generated internal ID (HDP...), we search platform_order_id.
                // If it uses the user-provided ID, we search order_id.
                const tx = await db.prepare('SELECT * FROM transactions WHERE platform_order_id = ? OR order_id = ?').get(orderId, orderId);

                if (!tx || tx.type !== 'payin') {
                    return res.status(404).send('Payment not found');
                }

                if (tx.status === 'success') {
                    return res.send('<h1>Payment already completed</h1>');
                }

                // Read template
                let html = fs.readFileSync(path.join(__dirname, 'public', 'pay.html'), 'utf8');

                // Extract deeplinks from stored param
                let deepLinks = {};
                try {
                    if (tx.param) {
                        const parsed = JSON.parse(tx.param);
                        if (parsed.deepLinks) {
                            deepLinks = parsed.deepLinks;
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse deeplinks:', e);
                }

                // Inject Data
                html = html.replace(/\{\{AMOUNT\}\}/g, parseFloat(tx.amount).toFixed(2));
                html = html.replace('{{ORDER_ID}}', tx.order_id); // Show merchant's order ID to user
                html = html.replace('{{DATE}}', new Date(tx.created_at).toLocaleDateString());
                html = html.replace('{{PAYMENT_URL}}', tx.payment_url); // Link to Silkpay

                // Inject deeplinks
                html = html.replace('{{DEEPLINK_PHONEPE}}', deepLinks.upi_phonepe || '');
                html = html.replace('{{DEEPLINK_PAYTM}}', deepLinks.upi_paytm || '');
                html = html.replace('{{DEEPLINK_UPI}}', deepLinks.upi_scan || tx.payment_url || '');

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

        // Error handling with logging to error.txt
        app.use((err, req, res, next) => {
            const context = `Route: ${req.method} ${req.path}`;
            logError(err, context);
            console.error('Unhandled error:', err);
            res.status(500).json({ code: 0, msg: 'Internal server error' });
        });

        // Start server
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
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
