require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDatabase, getDb } = require('../config/database');

async function reset() {
    console.log('Initializing DB...');
    await initDatabase();
    const db = getDb();
    const hash = bcrypt.hashSync('admin123', 10);

    console.log('Resetting Admin Password...');
    await db.prepare("UPDATE users SET password = ? WHERE username = 'admin'").run(hash);
    console.log('✅ Admin password reset to: admin123');
}

reset().catch(console.error);
