const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 配置
const DB_PATH = path.join(__dirname, 'data', 'music.db');
const COVERS_DIR = path.join(__dirname, 'covers');
const DEFAULT_COVER_URL = '/api/covers/default.png';

console.log('=== 修复音乐封面URL ===');
console.log(`数据库路径: ${DB_PATH}`);
console.log(`封面目录: ${COVERS_DIR}`);
console.log('------------------------');

// 连接数据库
const db = new Database(DB_PATH);

// 读取封面目录中的所有文件
const coverFiles = fs.readdirSync(COVERS_DIR)
  .filter(file => file.startsWith('cover_') && file.endsWith('.jpg'))
  .sort();

console.log(`找到 ${coverFiles.length} 个封面文件:`);
coverFiles.forEach(file => console.log(`  - ${file}`));

console.log('\n------------------------');
console.log('开始修复cover_url...');

// 准备更新语句
const updateStmt = db.prepare(
  'UPDATE songs SET cover_url = ? WHERE id = ?'
);

let fixedCount = 0;
let noCoverCount = 0;

// 处理每个封面文件
coverFiles.forEach(file => {
  // 从文件名中提取UUID
  const uuidMatch = file.match(/^cover_([0-9a-fA-F-]+)\.jpg$/);
  if (uuidMatch) {
    const uuid = uuidMatch[1];
    const correctCoverUrl = `/api/covers/${file}`;
    
    // 更新数据库
    const result = updateStmt.run(correctCoverUrl, uuid);
    
    if (result.changes > 0) {
      // 查询更新后的歌曲信息
      const song = db.prepare('SELECT title, artist FROM songs WHERE id = ?').get(uuid);
      console.log(`✓ 修复: 歌曲 "${song.title} - ${song.artist}" 的封面URL更新为 ${correctCoverUrl}`);
      fixedCount++;
    }
  }
});

// 对于没有封面文件的歌曲，将cover_url设置为null或默认封面
console.log('\n------------------------');
console.log('处理没有封面文件的歌曲...');

// 获取所有歌曲
const allSongs = db.prepare('SELECT id, title, artist FROM songs').all();

allSongs.forEach(song => {
  // 检查是否有对应的封面文件
  const expectedFile = `cover_${song.id}.jpg`;
  if (!coverFiles.includes(expectedFile)) {
    // 更新为null
    updateStmt.run(null, song.id);
    console.log(`✓ 更新: 歌曲 "${song.title} - ${song.artist}" 的封面URL设置为 null`);
    noCoverCount++;
  }
});

// 关闭数据库连接
db.close();

console.log('\n------------------------');
console.log('修复完成！');
console.log(`- 成功修复: ${fixedCount} 首歌曲`);
console.log(`- 无封面更新: ${noCoverCount} 首歌曲`);
console.log(`- 总计处理: ${fixedCount + noCoverCount} 首歌曲`);
