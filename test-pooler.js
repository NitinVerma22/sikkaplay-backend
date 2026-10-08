const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.ehvrlqdqdgfqjfstjncd:Nitin@221004@SikkaPlay@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
});

async function check() {
  await client.connect();
  try {
    const res = await client.query('SELECT "isFlagged" FROM "PlaygroundMessage" LIMIT 1');
    console.log('SUCCESS:', res.rows);
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  await client.end();
}
check();
