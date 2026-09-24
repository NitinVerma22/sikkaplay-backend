const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.production' });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
const ALGORITHM = 'aes-256-cbc';

function getIv(key) {
  return crypto.createHash('md5').update(key).digest();
}

function decrypt(text) {
  if (!text) return null;
  
  if (!text.includes(':')) {
    return text; // Probably not encrypted
  }
  
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    
    const keyHash = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
    
    const decipher = crypto.createDecipheriv(ALGORITHM, keyHash, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (error) {
    throw new Error('Decryption failed');
  }
}

async function run() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await p.query('SELECT id, "phoneNumber" FROM "User" WHERE "phoneNumber" IS NOT NULL');
  
  let failed = 0;
  for (const r of rows) {
    try {
      decrypt(r.phoneNumber);
    } catch(e) {
      failed++;
    }
  }
  console.log(`Failed ${failed} out of ${rows.length}`);
  p.end();
}
run();
