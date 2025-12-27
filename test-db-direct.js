const path = require('path');
const fs = require('fs');

// 直接读取数据库文件内容
const dbPath = path.join(__dirname, 'backend', 'data', 'music.db');

if (fs.existsSync(dbPath)) {
  console.log('数据库文件存在');
  console.log('文件大小:', fs.statSync(dbPath).size, 'bytes');
} else {
  console.log('数据库文件不存在');
}

// 检查封面目录
const coversPath = path.join(__dirname, 'backend', 'covers');
if (fs.existsSync(coversPath)) {
  console.log('\n封面目录存在');
  const coverFiles = fs.readdirSync(coversPath);
  console.log('封面文件数量:', coverFiles.length);
  if (coverFiles.length > 0) {
    console.log('前5个封面文件:', coverFiles.slice(0, 5));
  }
} else {
  console.log('\n封面目录不存在');
}
