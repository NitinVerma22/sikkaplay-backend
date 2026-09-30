const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://akinfra_sys:Akinfra2026Secure@127.0.0.1:5432/akinfra_core?sslmode=disable' });
client.connect()
  .then(() => client.query('SELECT * FROM "AppConfig";'))
  .then(res => console.log('AppConfig in WHM:', res.rows))
  .catch(console.error)
  .finally(() => client.end());
