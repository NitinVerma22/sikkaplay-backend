const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify' });

async function test() {
  try {
    const { rows: friendships } = await pool.query('SELECT * FROM "Friendship" WHERE "userOneId"=$1 OR "userTwoId"=$1', ['051b67f0-ef3c-4207-acd0-6b17333178ab']);
    console.log(`Found ${friendships.length} friendships`);
    
    for (const f of friendships) {
      const friendId = f.userOneId === '051b67f0-ef3c-4207-acd0-6b17333178ab' ? f.userTwoId : f.userOneId;
      const ids = ['051b67f0-ef3c-4207-acd0-6b17333178ab', friendId].sort();
      const channelName = `private-chat-${ids[0]}-${ids[1]}`;
      
      const { rows: msg } = await pool.query('SELECT * FROM "PlaygroundMessage" WHERE "channelName"=$1 ORDER BY "createdAt" DESC LIMIT 1', [channelName]);
      console.log(`Channel ${channelName} has message:`, msg.length > 0 ? msg[0].text : 'null');
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();
