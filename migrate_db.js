require('dotenv').config();
const { getDb, initDatabase } = require('./config/database');

(async () => {
    try {
        console.log('Initializing database...');
        await initDatabase();
        const db = getDb();

        console.log('Migrating database...');
        // Add payin_rate column if it doesn't exist
        try {
            await db.prepare('ALTER TABLE transactions ADD COLUMN payin_rate REAL').run();
            console.log('Added payin_rate column to transactions table.');
        } catch (e) {
            if (e.message && e.message.includes('duplicate column')) {
                console.log('payin_rate column already exists.');
            } else {
                console.error('Error adding column:', e);
            }
        }
        console.log('Migration complete.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
})();
