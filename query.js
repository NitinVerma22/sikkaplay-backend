const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.ehvrlqdqdgfqjfstjncd:Nitin@221004@SikkaPlay@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
client.connect().then(() => client.query('SELECT id, "phoneNumber" FROM "User"')).then(res => { console.log(res.rows.find(u => u.phoneNumber.includes('9305370277'))); client.end(); }).catch(console.error);
