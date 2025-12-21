const { initDatabase, getDb } = require('./config/database');

async function run() {
    try {
        await initDatabase();
        const db = getDb();

        console.log('Clearing pending payouts...');
        const info = db.prepare("DELETE FROM payouts WHERE status = 'pending'").run();
        console.log(`Deleted ${info.changes} pending payouts.`);

        console.log('Resetting all balances...');
        const info2 = db.prepare("UPDATE users SET balance = 0").run();
        console.log(`Updated ${info2.changes} users.`);

        console.log('System reset complete.');
    } catch (error) {
        console.error('Error resetting system:', error);
    }
}

run();
