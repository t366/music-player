const fs = require('fs');
const path = require('path');
const { parseFile } = require('music-metadata');

// 配置
const MUSIC_DIR = path.join(__dirname, 'music');

console.log('=== 检查音乐文件内嵌封面 ===');
console.log(`音乐目录: ${MUSIC_DIR}`);
console.log('------------------------');

// 获取音乐目录中的所有音频文件
const audioFiles = fs.readdirSync(MUSIC_DIR)
  .filter(file => ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(path.extname(file).toLowerCase()))
  .slice(0, 5); // 只检查前5个文件作为示例

console.log(`找到 ${audioFiles.length} 个音频文件，检查前5个:`);

audioFiles.forEach(file => {
  console.log(`\n检查文件: ${file}`);
  
  const filePath = path.join(MUSIC_DIR, file);
  
  parseFile(filePath)
    .then(metadata => {
      // 检查是否有封面
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const picture = metadata.common.picture[0];
        console.log(`✓ 包含封面: ${picture.format}, ${(picture.data.length / 1024).toFixed(2)} KB`);
        console.log(`  标题: ${metadata.common.title || '未知'}`);
        console.log(`  艺术家: ${metadata.common.artist || '未知'}`);
      } else {
        console.log(`✗ 不包含封面`);
        console.log(`  标题: ${metadata.common.title || '未知'}`);
        console.log(`  艺术家: ${metadata.common.artist || '未知'}`);
      }
    })
    .catch(error => {
      console.error(`✗ 解析失败: ${error.message}`);
    });
});
