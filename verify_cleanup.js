require('dotenv').config();
const { initDatabase, getDb } = require('./config/database');

async function verify() {
    await initDatabase();
    const db = getDb();

    // await the promise from .all()
    const users = await db.prepare("SELECT username, balance FROM users").all();
    console.log("Remaining Users:", users);

    const admin = users.find(u => u.username === 'admin');
    const demo = users.find(u => u.username === 'demo');

    if (users.length === 2 && admin && admin.balance === 1000000 && demo && demo.balance === 0) {
        console.log("VERIFICATION SUCCESS");
    } else {
        console.log("VERIFICATION FAILED");
    }
}

verify();
