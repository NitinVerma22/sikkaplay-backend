const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify' });

async function test() {
  try {
    const { rows } = await pool.query('SELECT count(*) FROM "HiddenChat"');
    console.log("HiddenChat count:", rows[0].count);
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    pool.end();
  }
}
test();
