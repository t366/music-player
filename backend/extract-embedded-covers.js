const fs = require('fs');
const path = require('path');
const { parseFile } = require('music-metadata');
const Database = require('better-sqlite3');

// 配置
const MUSIC_DIR = path.join(__dirname, 'music');
const COVERS_DIR = path.join(__dirname, 'covers');
const DB_PATH = path.join(__dirname, 'data', 'music.db');

console.log('=== 提取音乐文件内嵌封面 ===');
console.log(`音乐目录: ${MUSIC_DIR}`);
console.log(`封面目录: ${COVERS_DIR}`);
console.log(`数据库路径: ${DB_PATH}`);
console.log('------------------------');

// 确保封面目录存在
if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// 连接数据库
const db = new Database(DB_PATH);

// 获取所有歌曲
const songs = db.prepare('SELECT id, filename, cover_url FROM songs').all();
console.log(`找到 ${songs.length} 首歌曲`);

// 准备更新语句
const updateStmt = db.prepare('UPDATE songs SET cover_url = ? WHERE id = ?');

let extractedCount = 0;
let skippedCount = 0;
let errorCount = 0;

// 处理每个歌曲
async function processSongs() {
  for (const song of songs) {
    console.log(`\n处理歌曲: ${song.filename}`);
    console.log(`ID: ${song.id}`);
    
    const musicFilePath = path.join(MUSIC_DIR, song.filename);
    
    // 检查音乐文件是否存在
    if (!fs.existsSync(musicFilePath)) {
      console.log(`✗ 音乐文件不存在: ${musicFilePath}`);
      errorCount++;
      continue;
    }
    
    try {
      // 解析音乐文件获取元数据
      const metadata = await parseFile(musicFilePath);
      
      // 检查是否有内嵌封面
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const picture = metadata.common.picture[0];
        console.log(`✓ 找到内嵌封面: ${picture.format}, ${(picture.data.length / 1024).toFixed(2)} KB`);
        
        // 确定封面文件扩展名
        let extension = 'jpg';
        if (picture.format.toLowerCase().includes('png')) {
          extension = 'png';
        } else if (picture.format.toLowerCase().includes('gif')) {
          extension = 'gif';
        }
        
        // 生成封面文件名
        const coverFilename = `cover_${song.id}.${extension}`;
        const coverPath = path.join(COVERS_DIR, coverFilename);
        
        // 保存封面图片
        fs.writeFileSync(coverPath, picture.data);
        console.log(`✓ 封面已保存: ${coverFilename}`);
        
        // 更新数据库中的cover_url
        const coverUrl = `/api/covers/${coverFilename}`;
        const result = updateStmt.run(coverUrl, song.id);
        
        if (result.changes > 0) {
          console.log(`✓ 数据库已更新: cover_url = ${coverUrl}`);
          extractedCount++;
        } else {
          console.log(`✗ 数据库更新失败`);
          errorCount++;
        }
      } else {
        console.log(`✗ 未找到内嵌封面`);
        skippedCount++;
      }
    } catch (error) {
      console.log(`✗ 处理失败: ${error.message}`);
      errorCount++;
    }
  }
  
  // 统计信息
  console.log('\n========================');
  console.log('=== 提取完成 ===');
  console.log(`成功提取: ${extractedCount} 个封面`);
  console.log(`未包含封面: ${skippedCount} 首歌曲`);
  console.log(`处理错误: ${errorCount} 个错误`);
  console.log('========================');
  
  // 关闭数据库连接
  db.close();
}

// 开始处理
processSongs();
