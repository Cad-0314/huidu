require('dotenv').config();
const { getDb, initDatabase } = require('./config/database');

(async () => {
    try {
        console.log('Initializing database...');
        await initDatabase();
        const db = getDb();

        console.log('Migrating database...');

        // Add api_logs table
        try {
            await db.exec(`CREATE TABLE IF NOT EXISTS api_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT,
                request TEXT,
                response TEXT,
                duration INTEGER,
                status TEXT DEFAULT 'success',
                created_at TEXT DEFAULT (datetime('now'))
            )`);
            console.log('Created api_logs table.');
        } catch (e) {
            console.error('Error creating api_logs:', e);
        }

        console.log('Migration complete.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
})();
