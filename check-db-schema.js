const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://postgres.ehvrlqdqdgfqjfstjncd:Nitin@221004@SikkaPlay@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"
});

async function check() {
  await client.connect();
  const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='PlaygroundMessage';`);
  console.log(res.rows);
  await client.end();
}
check();
