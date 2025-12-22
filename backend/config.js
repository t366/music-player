// config.js - 云音乐Web播放器配置文件
// 该配置文件同时支持开发环境和生产环境

const path = require("path");

// 环境变量
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// 基础路径配置
const BASE_DIR = path.resolve(__dirname);
const DATA_DIR = path.resolve(BASE_DIR, "data");
const LOGS_DIR = path.resolve(BASE_DIR, "logs");

// 工具函数：转换为绝对路径
function resolvePath(dir) {
  return path.isAbsolute(dir) ? dir : path.resolve(BASE_DIR, dir);
}

// ======================== 服务器配置 ========================
const server = {
  // 监听端口
  port: parseInt(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",

  // 文件上传限制
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024, // 100MB
  maxUploadFiles: parseInt(process.env.MAX_UPLOAD_FILES) || 50,

  // 请求限制
  maxRequestSize: "10mb",

  // 超时设置
  uploadTimeout: 5 * 60 * 1000, // 5分钟
};

// ======================== 安全配置 ========================
const security = {
  // CORS 跨域配置
  cors: {
    // 生产环境必须配置具体的域名，不能使用 '*'
    origin: IS_PRODUCTION
      ? process.env.CORS_ORIGIN?.split(",") || false // 从环境变量读取，或禁用CORS
      : true, // 开发环境允许所有来源
    credentials: IS_PRODUCTION ? false : true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Range"],
    exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
  },

  // Content Security Policy (CSP) 内容安全策略
  csp: {
    directives: IS_PRODUCTION
      ? {
          // 生产环境：严格的安全策略
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"], // 禁止使用内联脚本
          styleSrc: ["'self'", "'unsafe-inline'"], // 允许内联样式（因为前端可能用内联样式）
          imgSrc: ["'self'", "data:", "blob:", "https:"], // 允许https图片
          fontSrc: ["'self'"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        }
      : {
          // 开发环境：允许使用CDN和内联脚本（为了方便开发）
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // 开发环境允许内联脚本（Toastify等）
            "'unsafe-eval'", // 开发环境允许eval
            "https://cdnjs.cloudflare.com",
            "https://cdn.jsdelivr.net",
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://cdnjs.cloudflare.com",
            "https://cdn.jsdelivr.net",
          ],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: [
            "'self'",
            "ws://localhost:3000",
            "wss://localhost:3000",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
          ],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
  },

  // Rate Limiting 限流配置
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15分钟
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 每个IP最多100个请求
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "请求过于频繁，请稍后再试" },
  },
};

// ======================== 数据库配置 ========================
const database = {
  // 数据库文件路径
  dbPath: path.join(DATA_DIR, "music.json"),
  backupPath: path.join(DATA_DIR, "backups"),

  // 数据库限制
  maxSongs: parseInt(process.env.MAX_SONGS) || 10000,

  // 自动清理
  cleanupInterval:
    parseInt(process.env.CLEANUP_INTERVAL) || 24 * 60 * 60 * 1000, // 24小时

  // 自动备份
  backupInterval: parseInt(process.env.BACKUP_INTERVAL) || 60 * 60 * 1000, // 1小时

  // 孤儿记录阈值
  maxOrphans: parseInt(process.env.MAX_ORPHANS) || 10,

  type: "sqlite", // 'json' or 'sqlite'
  sqlitePath: path.join(DATA_DIR, "music.db"),
  walMode: true, // 启用 WAL 模式
};

// ======================== 上传配置 ========================
const upload = {
  // 支持的文件扩展名
  allowedExtensions: process.env.ALLOWED_EXTENSIONS
    ? process.env.ALLOWED_EXTENSIONS.split(",")
    : [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".webm", ".mpeg"],

  // 支持的MIME类型
  allowedMimeTypes: process.env.ALLOWED_MIME_TYPES
    ? process.env.ALLOWED_MIME_TYPES.split(",")
    : [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/flac",
        "audio/aac",
        "audio/ogg",
        "audio/mp4",
        "audio/m4a",
        "audio/webm",
        "application/octet-stream",
      ],

  // 并发上传限制
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_UPLOADS) || 3,
};

// ======================== 媒体处理配置 ========================
const media = {
  // 支持的音频格式
  supportedFormats: process.env.SUPPORTED_FORMATS?.split(",") || [
    "mp3",
    "wav",
    "flac",
    "aac",
    "ogg",
    "m4a",
    "webm",
    "mpeg",
  ],

  // 封面配置
  coverFormats: ["jpg", "jpeg", "png", "gif"],
  coverSize: parseInt(process.env.COVER_SIZE) || 600,
  defaultCoverPath: path.join(BASE_DIR, "default-cover.png"),
};

// ======================== WebSocket 配置 ========================
const websocket = {
  // 最大连接数
  maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 100,

  // 心跳检测
  heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000, // 30秒
  heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT) || 45000, // 45秒超时

  // 最大消息大小
  maxMessageSize: parseInt(process.env.WS_MAX_MESSAGE_SIZE) || 10 * 1024 * 1024, // 10MB

  // 重连尝试
  reconnectAttempts: parseInt(process.env.WS_RECONNECT_ATTEMPTS) || 10,
};

// ======================== 日志配置 ========================
const logging = {
  // 日志级别
  level: process.env.LOG_LEVEL || (IS_PRODUCTION ? "info" : "debug"),

  // 日志文件路径
  logFile: path.join(LOGS_DIR, "app.log"),

  // 日志轮转
  maxSize: process.env.LOG_MAX_SIZE || "100m", // 100MB
  maxFiles: process.env.LOG_MAX_FILES || "30d", // 30天

  // 错误日志
  errorLog: path.join(LOGS_DIR, "error.log"),
};

// ======================== 缓存配置 ========================
const cache = {
  // 是否启用缓存
  enable: process.env.CACHE_ENABLE !== "false",

  // 缓存TTL
  ttl: parseInt(process.env.CACHE_TTL) || 5 * 60 * 1000, // 5分钟

  // 最大缓存条目数
  maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
};

// ======================== 导出配置 ========================
module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  BASE_DIR,
  DATA_DIR,
  LOGS_DIR,
  server,
  security,
  database,
  upload,
  media,
  websocket,
  logging,
  cache,
};

// ======================== 配置验证 ========================
// 验证关键配置项
function validateConfig() {
  const errors = [];

  // 验证端口号
  if (
    !Number.isInteger(server.port) ||
    server.port < 1 ||
    server.port > 65535
  ) {
    errors.push(`端口号无效: ${server.port}`);
  }

  // 验证上传大小限制
  if (server.maxFileSize < 1024 * 1024) {
    errors.push("文件大小限制太小，建议至少1MB");
  }

  // 验证路径是否存在
  const pathsToCheck = [
    { name: "DATA_DIR", path: DATA_DIR },
    { name: "LOGS_DIR", path: LOGS_DIR },
  ];

  for (const { name, path: dirPath } of pathsToCheck) {
    if (!path.isAbsolute(dirPath)) {
      errors.push(`${name} 必须是绝对路径: ${dirPath}`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ 配置验证失败:\n" + errors.join("\n"));
    process.exit(1);
  }
}

// 仅在直接运行时验证
if (require.main === module) {
  validateConfig();
  console.log("✅ 配置验证通过");
}
