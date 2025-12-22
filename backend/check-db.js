const Database = require('better-sqlite3');
const path = require('path');

// 连接到数据库
const dbPath = path.join(__dirname, 'data', 'music.db');
const db = new Database(dbPath);

try {
  // 查询歌曲数量
  const count = db.prepare('SELECT COUNT(*) as total FROM songs').get();
  console.log(`数据库中歌曲总数: ${count.total}`);
  
  // 可选：查询前几首歌曲来验证数据
  const songs = db.prepare('SELECT * FROM songs LIMIT 5').all();
  console.log('前5首歌曲:');
  songs.forEach(song => {
    console.log(`  ID: ${song.id}, 标题: ${song.title}, 艺术家: ${song.artist}`);
  });
} catch (error) {
  console.error('查询数据库失败:', error);
} finally {
  // 关闭数据库连接
  db.close();
}
