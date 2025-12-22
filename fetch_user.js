const db = require('better-sqlite3')('hdu.sqlite');
const user = db.prepare("SELECT * FROM users WHERE uuid LIKE '%d41c7a4b%'").get();
console.log(user ? JSON.stringify(user, null, 2) : 'User not found');
