const Database = require('better-sqlite3');
const path = require('path');

// 连接数据库
const dbPath = path.join(__dirname, 'backend', 'data', 'music.db');
const db = new Database(dbPath);

// 查询所有歌曲记录
const songs = db.prepare('SELECT * FROM songs LIMIT 5').all();

// 输出歌曲记录结构
console.log('=== 歌曲记录结构 ===');
if (songs.length > 0) {
  console.log('字段列表:', Object.keys(songs[0]));
  console.log('\n=== 第一条歌曲记录 ===');
  console.log(JSON.stringify(songs[0], null, 2));
} else {
  console.log('数据库中没有歌曲记录');
}

// 关闭数据库连接
db.close();
