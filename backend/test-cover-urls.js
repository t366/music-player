const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 连接数据库
const dbPath = path.join(__dirname, 'data', 'music.db');
const db = new Database(dbPath);

// 读取封面目录
const coversDir = path.join(__dirname, 'covers');
const coverFiles = fs.readdirSync(coversDir);

// 查询所有歌曲记录
const songs = db.prepare('SELECT id, title, cover_url FROM songs').all();

console.log('=== 封面URL检查结果 ===');
console.log(`数据库中有 ${songs.length} 首歌曲`);
console.log(`封面目录中有 ${coverFiles.length} 个文件`);

// 检查默认封面是否存在
const defaultCoverExists = coverFiles.includes('default.png');
console.log(`默认封面 default.png 存在: ${defaultCoverExists}`);

// 检查每个歌曲的封面URL是否与实际文件匹配
let matches = 0;
let mismatches = 0;

for (const song of songs) {
  if (song.cover_url) {
    // 提取文件名
    const filename = path.basename(song.cover_url);
    const fileExists = coverFiles.includes(filename);
    
    if (fileExists) {
      matches++;
    } else {
      mismatches++;
      console.log(`不匹配: 歌曲 "${song.title}" (${song.id}) 的封面文件 ${filename} 不存在`);
    }
  } else {
    console.log(`缺少封面: 歌曲 "${song.title}" (${song.id}) 没有封面URL`);
  }
}

console.log(`\n匹配: ${matches} 首歌曲`);
console.log(`不匹配: ${mismatches} 首歌曲`);

// 关闭数据库连接
db.close();
