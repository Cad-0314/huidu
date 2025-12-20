const { initDatabase } = require('../config/database');

async function migrate() {
    try {
        console.log('Starting migration via initDatabase...');
        await initDatabase();
        console.log('Database initialized and migrations applied.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();
