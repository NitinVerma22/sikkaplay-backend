const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:sikkaPlay_2210@34.131.44.10:5432/postgres?sslmode=no-verify' });

async function test() {
  const userId = '051b67f0-ef3c-4207-acd0-6b17333178ab'; // A user who recently chatted
  try {
    const { rows: friendships } = await pool.query('SELECT * FROM "Friendship" WHERE ("userOneId"=$1 OR "userTwoId"=$1) AND status=\'ACCEPTED\'', [userId]);
    const friends = [];
    for (const f of friendships) {
      const friendId = f.userOneId === userId ? f.userTwoId : f.userOneId;
      const { rows: friendUser } = await pool.query('SELECT id, name, username FROM "User" WHERE id=$1', [friendId]);
      if (friendUser.length === 0) continue;
      
      const ids = [userId, friendId].sort();
      const channelName = `private-chat-${ids[0]}-${ids[1]}`;
      
      const { rows: lastMessage } = await pool.query('SELECT text, "createdAt" FROM "PlaygroundMessage" WHERE "channelName"=$1 ORDER BY "createdAt" DESC LIMIT 1', [channelName]);
      
      friends.push({
        friendId,
        username: friendUser[0].username,
        lastMessageText: lastMessage.length > 0 ? lastMessage[0].text : null
      });
    }
    console.log("Returned friends length:", friends.length);
    console.log("First friend:", friends[0]);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();
