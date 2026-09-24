const { Pool } = require('pg');

async function test() {
  console.log("Starting pg SSL test...");
  const pool = new Pool({
    connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify'
  });

  try {
    const res = await pool.query('SELECT count(*) FROM "public"."User"');
    console.log("SUCCESS! User count:", res.rows[0].count);
  } catch (e) {
    console.error("ERROR CAUGHT IN PG:");
    console.error(e);
  } finally {
    await pool.end();
  }
}

test();
