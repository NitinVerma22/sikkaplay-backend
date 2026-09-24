const { Pool } = require('pg');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = Buffer.from('super-secret-sikkaplay-key'.padEnd(32, '0'));

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

const p = new Pool({ connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify' });

p.query('SELECT "phoneNumber" FROM "User" LIMIT 5').then(r => { 
  console.log("Encrypted phones from DB:", r.rows); 
  p.end(); 
}).catch(e => { console.log(e); p.end(); });
