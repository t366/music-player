const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 配置
const DB_PATH = path.join(__dirname, 'data', 'music.db');
const COVERS_DIR = path.join(__dirname, 'covers');

console.log('=== 检查封面文件与数据库ID匹配情况 ===');
console.log(`数据库路径: ${DB_PATH}`);
console.log(`封面目录: ${COVERS_DIR}`);
console.log('------------------------');

// 连接数据库
const db = new Database(DB_PATH);

// 读取封面目录中的所有封面文件
const coverFiles = fs.readdirSync(COVERS_DIR)
  .filter(file => file.startsWith('cover_') && file.endsWith('.jpg'))
  .sort();

console.log(`找到 ${coverFiles.length} 个封面文件:`);

// 获取数据库中所有歌曲的ID
const songIds = db.prepare('SELECT id FROM songs').all().map(row => row.id);
console.log(`数据库中有 ${songIds.length} 首歌曲`);

console.log('\n------------------------');
console.log('检查封面文件UUID是否存在于数据库中...');

let matchCount = 0;
let noMatchCount = 0;

coverFiles.forEach(file => {
  // 从文件名中提取UUID
  const uuidMatch = file.match(/^cover_([0-9a-fA-F-]+)\.jpg$/);
  if (uuidMatch) {
    const uuid = uuidMatch[1];
    
    if (songIds.includes(uuid)) {
      // 查询匹配到的歌曲信息
      const song = db.prepare('SELECT title, artist FROM songs WHERE id = ?').get(uuid);
      console.log(`✓ 匹配: 封面文件 ${file} 对应歌曲 "${song.title} - ${song.artist}"`);
      matchCount++;
    } else {
      console.log(`✗ 不匹配: 封面文件 ${file} 的UUID (${uuid}) 不在数据库中`);
      noMatchCount++;
    }
  } else {
    console.log(`✗ 无效文件名: ${file}`);
    noMatchCount++;
  }
});

console.log('\n------------------------');
console.log('检查完成！');
console.log(`- 匹配到 ${matchCount} 个封面文件`);
console.log(`- 未匹配到 ${noMatchCount} 个封面文件`);

// 关闭数据库连接
db.close();
