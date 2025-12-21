require('dotenv').config();
const { initDatabase, getDb } = require('./config/database');

async function run() {
    try {
        console.log('Initializing database...');
        const db = await initDatabase();
        // Note: initDatabase returns the wrapper needed for getDb() to work, 
        // but getDb() returns the SAME wrapper.

        console.log('Starting system cleanup...');

        // 1. Delete users except admin and demo
        console.log("Deleting extra merchants...");
        // async run() returns { changes, lastInsertRowid }
        const delUsers = await db.prepare("DELETE FROM users WHERE username NOT IN ('admin', 'demo')").run();
        console.log(`Deleted ${delUsers.changes} merchants.`);

        // 2. Cleanup orphaned data
        console.log("Cleaning orphaned transactions...");
        const delTx = await db.prepare("DELETE FROM transactions WHERE user_id NOT IN (SELECT id FROM users)").run();
        console.log(`Deleted ${delTx.changes} transactions.`);

        console.log("Cleaning orphaned payouts...");
        const delPo = await db.prepare("DELETE FROM payouts WHERE user_id NOT IN (SELECT id FROM users)").run();
        console.log(`Deleted ${delPo.changes} payouts.`);

        // 3. Reset Balances
        console.log("Resetting balances...");

        // Demo = 0
        const demo = await db.prepare("UPDATE users SET balance = 0 WHERE username = 'demo'").run();
        console.log(`Demo balance reset (Changes: ${demo.changes})`);

        // Admin = 1,000,000
        const admin = await db.prepare("UPDATE users SET balance = 1000000 WHERE username = 'admin'").run();
        console.log(`Admin balance reset to 1,000,000 (Changes: ${admin.changes})`);

        console.log("Cleanup complete.");

    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

run();
