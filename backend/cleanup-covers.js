const fs = require('fs');
const path = require('path');

// 配置
const COVERS_DIR = path.join(__dirname, 'covers');

console.log('=== 清理不匹配的封面文件 ===');
console.log(`封面目录: ${COVERS_DIR}`);
console.log('------------------------');

// 读取封面目录中的所有文件
const files = fs.readdirSync(COVERS_DIR);

// 找出所有需要删除的封面文件（不包括default.png）
const coversToDelete = files.filter(file => 
  file.startsWith('cover_') && file.endsWith('.jpg')
);

console.log(`找到 ${coversToDelete.length} 个需要删除的封面文件:`);
coversToDelete.forEach(file => console.log(`  - ${file}`));

console.log('\n------------------------');
console.log('开始删除文件...');

let deletedCount = 0;

coversToDelete.forEach(file => {
  try {
    const filePath = path.join(COVERS_DIR, file);
    fs.unlinkSync(filePath);
    console.log(`✓ 删除成功: ${file}`);
    deletedCount++;
  } catch (error) {
    console.error(`✗ 删除失败: ${file} - ${error.message}`);
  }
});

console.log('\n------------------------');
console.log('清理完成！');
console.log(`- 成功删除 ${deletedCount} 个文件`);
console.log(`- 剩余文件: default.png`);
console.log('\n所有歌曲将使用默认封面。');
