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
