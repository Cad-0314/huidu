const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Detect environment and set database path
// Render mounts to /opt/render/project/src/database
// Railway mounts to /app/database
// Local uses ./database
function getDbPath() {
    const possiblePaths = [
        '/opt/render/project/src/database',  // Render
        '/app/database',                      // Railway
        path.join(__dirname, '..', 'database') // Local
    ];

    for (const dir of possiblePaths) {
        if (fs.existsSync(dir)) {
            console.log('Using database directory:', dir);
            return path.join(dir, 'vspay.db');
        }
    }

    // Fallback to local
    const localDir = path.join(__dirname, '..', 'database');
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }
    return path.join(localDir, 'vspay.db');
}

const dbPath = getDbPath();
const dbDir = path.dirname(dbPath);

let db = null;

// Ensure database directory exists
function ensureDbDir() {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log('Created database directory:', dbDir);
    }
}

// Wrapper to make sql.js work like better-sqlite3
class DatabaseWrapper {
    constructor(database) {
        this.database = database;
    }

    prepare(sql) {
        const self = this;
        return {
            run(...params) {
                self.database.run(sql, params);
                self.saveToFile();
                return { changes: self.database.getRowsModified() };
            },
            get(...params) {
                const stmt = self.database.prepare(sql);
                stmt.bind(params);
                if (stmt.step()) {
                    const result = stmt.getAsObject();
                    stmt.free();
                    return result;
                }
                stmt.free();
                return undefined;
            },
            all(...params) {
                const results = [];
                const stmt = self.database.prepare(sql);
                stmt.bind(params);
                while (stmt.step()) {
                    results.push(stmt.getAsObject());
                }
                stmt.free();
                return results;
            }
        };
    }

    exec(sql) {
        this.database.run(sql);
        this.saveToFile();
    }

    pragma(sql) {
        this.database.run(`PRAGMA ${sql}`);
    }

    saveToFile() {
        // Save database to persistent storage
        ensureDbDir();
        const data = this.database.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

async function initDatabase() {
    // Return existing db if already initialized
    if (db) return db;

    ensureDbDir();
    const SQL = await initSqlJs();

    // Try to load existing database
    let database;
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        database = new SQL.Database(buffer);
        console.log('Loaded existing database from:', dbPath);
    } else {
        database = new SQL.Database();
        console.log('Created new database at:', dbPath);
    }

    db = new DatabaseWrapper(database);

    // Initialize schema
    initializeSchema();

    return db;
}

function initializeSchema() {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'merchant',
            merchant_key TEXT UNIQUE,
            balance REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            callback_url TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Transactions table (pay-in)
    db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
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
        )
    `);

    // Payouts table
    db.exec(`
        CREATE TABLE IF NOT EXISTS payouts (
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
        )
    `);

    // Callback logs table
    db.exec(`
        CREATE TABLE IF NOT EXISTS callback_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER,
            payout_id INTEGER,
            type TEXT NOT NULL,
            request_body TEXT,
            response TEXT,
            status TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Create default admin if not exists
    const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (!adminExists) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        const adminUuid = uuidv4();
        const merchantKey = 'MK_' + uuidv4().replace(/-/g, '').substring(0, 24).toUpperCase();

        db.prepare(`
            INSERT INTO users (uuid, username, email, password, name, role, merchant_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(adminUuid, 'admin', 'admin@vspay.com', hashedPassword, 'System Admin', 'admin', merchantKey);

        console.log('Default admin created: username=admin / password=admin123');
    }

    // Insert default settings
    try {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payin_rate', '0.05');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payout_rate', '0.03');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('payout_fixed_fee', '6');
    } catch (e) {
        // Settings already exist
    }

    console.log('Database initialized successfully');
}

function getDb() {
    return db;
}

module.exports = { initDatabase, getDb };
