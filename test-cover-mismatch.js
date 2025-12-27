const path = require('path');
const fs = require('fs').promises;
const Database = require('better-sqlite3');

async function testCoverMismatch() {
  try {
    // 连接数据库
    const dbPath = path.join(__dirname, 'backend', 'data', 'music.db');
    const db = new Database(dbPath);
    
    // 获取所有歌曲
    const stmt = db.prepare('SELECT id, title, cover_url FROM songs ORDER BY upload_date DESC');
    const songs = stmt.all();
    
    console.log(`共查询到 ${songs.length} 首歌曲`);
    
    // 获取封面目录中的所有文件
    const coversDir = path.join(__dirname, 'backend', 'covers');
    const coverFiles = await fs.readdir(coversDir);
    
    console.log(`封面目录中共有 ${coverFiles.length} 个文件`);
    
    // 分析匹配情况
    let matchedCount = 0;
    let mismatchedCount = 0;
    let noCoverCount = 0;
    
    const mismatchedSongs = [];
    
    for (const song of songs) {
      if (!song.cover_url) {
        noCoverCount++;
        continue;
      }
      
      // 提取封面URL中的文件名
      const filename = path.basename(song.cover_url);
      
      // 检查文件是否存在
      const fileExists = coverFiles.includes(filename);
      
      if (fileExists) {
        matchedCount++;
      } else {
        mismatchedCount++;
        mismatchedSongs.push({
          songId: song.id,
          title: song.title,
          coverUrl: song.cover_url,
          filename: filename
        });
        
        // 检查是否有基于song.id的封面文件
        const expectedFilename = `cover_${song.id}.jpg`;
        const expectedFileExists = coverFiles.includes(expectedFilename);
        
        if (expectedFileExists) {
          console.log(`⚠️  发现不匹配但有预期文件: 歌曲ID ${song.id}, 当前封面 ${filename}, 预期封面 ${expectedFilename}`);
        }
      }
    }
    
    console.log('\n=== 分析结果 ===');
    console.log(`总歌曲数: ${songs.length}`);
    console.log(`无封面歌曲数: ${noCoverCount}`);
    console.log(`封面匹配歌曲数: ${matchedCount}`);
    console.log(`封面不匹配歌曲数: ${mismatchedCount}`);
    
    if (mismatchedSongs.length > 0) {
      console.log('\n=== 不匹配的歌曲详情 (前10个) ===');
      mismatchedSongs.slice(0, 10).forEach((song, index) => {
        console.log(`${index + 1}. ID: ${song.songId}, 标题: ${song.title}, 封面URL: ${song.coverUrl}, 文件名: ${song.filename}`);
      });
    }
    
    // 检查是否有未被使用的封面文件
    const usedFilenames = new Set(songs.map(song => song.cover_url ? path.basename(song.cover_url) : null).filter(Boolean));
    const unusedCoverFiles = coverFiles.filter(filename => !usedFilenames.has(filename));
    
    console.log(`\n=== 未被使用的封面文件数: ${unusedCoverFiles.length} ===`);
    if (unusedCoverFiles.length > 0) {
      console.log('未被使用的封面文件 (前10个):');
      unusedCoverFiles.slice(0, 10).forEach(filename => console.log(`  - ${filename}`));
    }
    
    db.close();
    
    return { mismatchedSongs, unusedCoverFiles };
    
  } catch (error) {
    console.error('测试失败:', error);
    throw error;
  }
}

testCoverMismatch();
