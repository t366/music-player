# music-player

# Web音乐播放器

一个功能完整的Web版音乐播放器，仿网易云音乐设计，支持本地音乐上传、元数据提取、封面获取和歌词显示。


## 功能特点

### 核心功能
1. **音乐播放**：支持MP3、WAV、FLAC、AAC、OGG、M4A格式
2. **元数据提取**：自动从音乐文件中提取标题、艺术家、专辑等信息
3. **封面获取**：
   - 优先从音乐文件内嵌封面提取
   - 如果没有，自动从网易云音乐等平台获取
4. **歌词功能**：
   - 优先从音乐文件内嵌歌词提取
   - 如果没有，自动从网络获取LRC格式歌词
   - 实时歌词高亮显示
5. **每日推荐**：基于日期的智能推荐算法
6. **播放列表**：喜欢列表、播放历史
7. **音乐库管理**：上传、删除、搜索音乐
8. **响应式设计**：适配桌面和移动设备

### 特色功能
- **多音源支持**：可扩展的音乐源插件系统
- **实时同步**：WebSocket实现实时播放状态同步
- **离线缓存**：本地缓存提高访问速度
- **主题切换**：深色/浅色主题自动适配

## 技术架构

### 前端技术栈
- HTML5、CSS3、原生JavaScript
- Font Awesome 图标库
- Toastify JS 通知组件
- 响应式设计，兼容多端设备

### 后端技术栈
- Node.js + Express 框架
- SQLite 数据库
- music-metadata 音频元数据解析
- WebSocket 实时通信
- Multer 文件上传处理

### 目录结构
```
music-player/
├── backend/              # 后端代码
│   ├── music/           # 音乐文件存储目录
│   ├── covers/          # 封面图片存储目录
│   ├── lyrics/          # 歌词文件存储目录
│   ├── db/              # 数据库文件
│   ├── utils/           # 工具类模块
│   ├── server.js        # 主服务入口
│   └── package.json     # 后端依赖配置
├── frontend/            # 前端代码
│   ├── index.html       # 主页面
│   ├── css/
│   │   └── style.css    # 样式文件
│   └── js/
│       └── script.js    # 脚本文件
└── README.md            # 项目说明文档
```

## 快速开始

### 环境要求
- Node.js >= 16.0.0
- npm >= 8.0.0

### 安装步骤
1. 克隆项目代码：
```bash
git clone https://github.com/t366/music-player.git
```

2. 安装后端依赖：
```bash
cd backend
npm install
```

3. 启动服务：
```bash
npm start
```

4. 访问应用：
打开浏览器访问 `http://localhost:3000`

## 开发指南

### 项目配置
- 端口配置：默认3000，可通过环境变量PORT修改
- 文件上传限制：默认100MB，可通过MAX_FILE_SIZE修改
- 清理间隔：默认24小时，可通过CLEANUP_INTERVAL修改

### API接口
- GET `/api/songs` - 获取歌曲列表
- POST `/api/upload` - 上传音乐文件
- GET `/api/cover/:id` - 获取歌曲封面
- GET `/api/lyrics/:id` - 获取歌词文件

### 扩展音源
项目支持自定义音源插件，可通过编写JavaScript脚本扩展音乐来源。

## 贡献指南
欢迎提交Issue和Pull Request来帮助改进项目。

## 许可证
MIT License
