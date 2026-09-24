const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify' });
p.query('SELECT * FROM "Friendship" WHERE "userOneId"=\'051b67f0-ef3c-4207-acd0-6b17333178ab\' AND "userTwoId"=\'2b34f3c3-5ff5-4663-a45a-9c66299f9e14\' OR "userOneId"=\'2b34f3c3-5ff5-4663-a45a-9c66299f9e14\' AND "userTwoId"=\'051b67f0-ef3c-4207-acd0-6b17333178ab\'').then(r => { console.log("Friendships for recent chat:", r.rows); p.end(); }).catch(e => { console.log("Error:", e.message); p.end(); });
