const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.ehvrlqdqdgfqjfstjncd:Nitin@221004@SikkaPlay@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=disable' });
client.connect()
  .then(() => client.query('SELECT * FROM "AppConfig";'))
  .then(res => console.log('AppConfig in Supabase:', res.rows))
  .catch(console.error)
  .finally(() => client.end());
