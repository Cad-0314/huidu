const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@libsql/client');
const initSqlJs = require('sql.js');

// Database configuration
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

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

    if (TURSO_URL && TURSO_URL.includes('turso.io')) {
        console.log('Initializing Turso Database...');
        try {
            const client = createClient({
                url: TURSO_URL,
                authToken: TURSO_TOKEN
            });
            db = new AsyncDatabaseWrapper('turso', client);
            console.log('Connected to Turso');
        } catch (e) {
            console.error('Failed to connect to Turso:', e);
            throw e;
        }
    } else {
        console.log('Initializing Local SQLite (sql.js)...');
        // Ensure local DB loading
        const dbDir = path.join(__dirname, '..', 'database');
        const dbPath = path.join(dbDir, 'vspay.db');
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

        const SQL = await initSqlJs();
        let database;
        if (fs.existsSync(dbPath)) {
            database = new SQL.Database(fs.readFileSync(dbPath));
            console.log('Loaded local DB');
        } else {
            database = new SQL.Database();
            console.log('Created new local DB');
        }
        db = new AsyncDatabaseWrapper('local', database);
    }

    await initializeSchema();
    return db;
}

function getDb() {
    if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
    return db;
}

// Initialize Schema (Table Creations)
async function initializeSchema() {
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
            updated_at TEXT DEFAULT (datetime('now'))
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
            transaction_id INTEGER,
            payout_id INTEGER,
            type TEXT NOT NULL,
            request_body TEXT,
            response TEXT,
            status TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )`
    ];

    for (const sql of tableQueries) {
        await db.exec(sql);
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
}

module.exports = { initDatabase, getDb };
