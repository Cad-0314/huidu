const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@libsql/client');
const initSqlJs = require('sql.js');

// Database configuration
// const TURSO_URL = process.env.TURSO_DATABASE_URL; // Moved inside initDatabase to ensure loaded
// const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db = null;

// Async Database Wrapper (Unified Interface)
class AsyncDatabaseWrapper {
    constructor(type, client) {
        this.type = type;
        this.client = client; // Turso client or sql.js Database instance
    }

    prepare(sql) {
        const self = this;
        return {
            async run(...params) {
                if (self.type === 'turso') {
                    const result = await self.client.execute({ sql, args: params });
                    return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
                } else {
                    self.client.run(sql, params);
                    self.saveLocalToFile();
                    return { changes: self.client.getRowsModified() };
                }
            },
            async get(...params) {
                if (self.type === 'turso') {
                    const result = await self.client.execute({ sql, args: params });
                    // Turso returns { ... rows: [ { col: val }, ... ] }
                    return result.rows[0];
                } else {
                    const stmt = self.client.prepare(sql);
                    stmt.bind(params);
                    let result;
                    if (stmt.step()) {
                        result = stmt.getAsObject();
                    }
                    stmt.free();
                    return result;
                }
            },
            async all(...params) {
                if (self.type === 'turso') {
                    const result = await self.client.execute({ sql, args: params });
                    return result.rows;
                } else {
                    const results = [];
                    const stmt = self.client.prepare(sql);
                    stmt.bind(params);
                    while (stmt.step()) {
                        results.push(stmt.getAsObject());
                    }
                    stmt.free();
                    return results;
                }
            }
        };
    }

    // Helper to execute raw SQL (usually DDL)
    async exec(sql) {
        if (this.type === 'turso') {
            await this.client.executeMultiple(sql);
        } else {
            this.client.run(sql);
            this.saveLocalToFile();
        }
    }

    saveLocalToFile() {
        if (this.type === 'local') {
            const dbDir = path.join(__dirname, '..', 'database');
            const dbPath = path.join(dbDir, 'vspay.db');
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
            const data = this.client.export();
            fs.writeFileSync(dbPath, Buffer.from(data));
        }
    }
}

async function initDatabase() {
    if (db) return db;

    const TURSO_URL = process.env.TURSO_DATABASE_URL;
    const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

    if (!TURSO_URL || !TURSO_TOKEN) {
        throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for strict Turso mode.');
    }

    console.log('Initializing Turso Database...');
    try {
        const client = createClient({
            url: TURSO_URL,
            authToken: TURSO_TOKEN
        });
        db = new AsyncDatabaseWrapper('turso', client);
        console.log('Connected to Turso');
    } catch (e) {
        console.error('CRITICAL: Failed to connect to Turso:', e);
        throw e; // Strict mode: Fail if Turso fails
    }

    // Initialize Schema (if needed, though usually Turso is persistent)
    // We can keep it to ensure tables exist
    await initializeSchema();
    return db;
}

function getDb() {
    if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
    return db;
}

// Initialize Schema (Table Creations)
async function initializeSchema() {
    // No WAL for Turso (managed remotely)


    const tableQueries = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'merchant',
            merchant_key TEXT UNIQUE,
            balance REAL DEFAULT 0,
            payin_rate REAL DEFAULT 5.0,
            payout_rate REAL DEFAULT 3.0,
            status TEXT DEFAULT 'active',
            telegram_group_id TEXT,
            callback_url TEXT,
            two_factor_enabled BOOLEAN DEFAULT 0,
            two_factor_secret TEXT,
            two_factor_temp_secret TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            order_id TEXT UNIQUE NOT NULL,
            platform_order_id TEXT,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            order_amount REAL,
            fee REAL DEFAULT 0,
            net_amount REAL,
            status TEXT DEFAULT 'pending',
            payment_url TEXT,
            callback_data TEXT,
            utr TEXT,
            param TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            payin_rate REAL
        )`,
        `CREATE TABLE IF NOT EXISTS payouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            order_id TEXT UNIQUE NOT NULL,
            platform_order_id TEXT,
            payout_type TEXT NOT NULL,
            amount REAL NOT NULL,
            fee REAL DEFAULT 0,
            net_amount REAL,
            status TEXT DEFAULT 'pending',
            account_number TEXT,
            ifsc_code TEXT,
            account_name TEXT,
            wallet_address TEXT,
            network TEXT,
            approved_by INTEGER,
            approved_at TEXT,
            rejection_reason TEXT,
            callback_data TEXT,
            utr TEXT,
            message TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS callback_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT, -- Added to store incoming external/merchant ID
            transaction_id INTEGER,
            payout_id INTEGER,
            type TEXT NOT NULL,
            request_body TEXT,
            response TEXT,
            status TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS upi_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upi_id TEXT UNIQUE NOT NULL,
            is_ours BOOLEAN DEFAULT 1,
            source TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS api_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT,
            request TEXT,
            response TEXT,
            duration INTEGER,
            status TEXT DEFAULT 'success',
            created_at TEXT DEFAULT (datetime('now'))
        )`
    ];

    // Add Analytics Table
    tableQueries.push(`CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            meta_data TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`);

    for (const sql of tableQueries) {
        await db.exec(sql);
    }

    // Indices for performance
    const indexQueries = [
        'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
        'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_platform_order_id ON transactions(platform_order_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_uuid ON transactions(uuid)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_order_id ON payouts(order_id)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_platform_order_id ON payouts(platform_order_id)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at)',
        'CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at)',
        'CREATE INDEX IF NOT EXISTS idx_upi_records_upi_id ON upi_records(upi_id)',
        'CREATE INDEX IF NOT EXISTS idx_analytics_order_id ON analytics_events(order_id)',
        'CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at)'
    ];

    for (const sql of indexQueries) {
        try {
            await db.exec(sql);
        } catch (e) { }
    }

    // Migrations
    try {
        await db.exec('ALTER TABLE callback_logs ADD COLUMN order_id TEXT');
    } catch (e) {
        // Ignore if exists
    }

    // Default Admin & Settings
    const adminExists = await db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (!adminExists) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        const adminUuid = uuidv4();
        const merchantKey = 'MK_' + uuidv4().replace(/-/g, '').substring(0, 24).toUpperCase();
        await db.prepare(`
            INSERT INTO users (uuid, username, email, password, name, role, merchant_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(adminUuid, 'admin', 'admin@vspay.com', hashedPassword, 'System Admin', 'admin', merchantKey);
        console.log('Admin initialized');
    }

    // Demo User
    const demoExists = await db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
    if (!demoExists) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        const demoUuid = uuidv4();
        const merchantKey = 'MK_DEMO_' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
        await db.prepare(`
            INSERT INTO users (uuid, username, email, password, name, role, merchant_key, two_factor_enabled, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')
        `).run(demoUuid, 'demo', 'demo@vspay.com', hashedPassword, 'Demo Merchant', 'merchant', merchantKey);
        console.log('Demo user initialized');
    }

    // Settings
    try {
        await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payin_rate', '0.05');
        await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payout_rate', '0.03');
        await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payout_fixed_fee', '6');
    } catch (e) { }

    // Migrations
    try {
        await db.exec('ALTER TABLE users ADD COLUMN telegram_group_id TEXT');
        console.log('Applied migration: Added telegram_group_id to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN payin_rate REAL DEFAULT 5.0');
        console.log('Applied migration: Added payin_rate to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN payout_rate REAL DEFAULT 3.0');
        console.log('Applied migration: Added payout_rate to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT 0');
        console.log('Applied migration: Added two_factor_enabled to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN two_factor_secret TEXT');
        console.log('Applied migration: Added two_factor_secret to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN two_factor_temp_secret TEXT');
        console.log('Applied migration: Added two_factor_temp_secret to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN usdt_rate REAL DEFAULT 100.0');
        console.log('Applied migration: Added usdt_rate to users');
    } catch (e) { }
    try {
        await db.exec("ALTER TABLE payouts ADD COLUMN source TEXT DEFAULT 'api'");
        console.log('Applied migration: Added source column to payouts');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE users ADD COLUMN ip_whitelist TEXT');
        console.log('Applied migration: Added ip_whitelist to users');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE payouts ADD COLUMN callback_url TEXT');
        console.log('Applied migration: Added callback_url to payouts');
    } catch (e) { }

    try {
        await db.exec('ALTER TABLE payouts ADD COLUMN param TEXT');
        console.log('Applied migration: Added param to payouts');
    } catch (e) { }

    try {
        await db.exec("ALTER TABLE users ADD COLUMN channel TEXT DEFAULT 'silkpay'");
        console.log('Applied migration: Added channel to users');
    } catch (e) { }

    try {
        await db.exec("ALTER TABLE transactions ADD COLUMN channel TEXT DEFAULT 'silkpay'");
        console.log('Applied migration: Added channel to transactions');
    } catch (e) { }
}

module.exports = { initDatabase, getDb };
