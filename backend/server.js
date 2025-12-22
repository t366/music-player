const express = require("express");
const multer = require("multer");
const fs = require("fs").promises;
const fsSync = require("fs"); // ⚠️ 新增：不要用 fs.promises
const path = require("path");
const mm = require("music-metadata");
const axios = require("axios");
const cors = require("cors");
const WebSocket = require("ws");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

// 导入日志工具
const { getLogger } = require("./utils/logger");
const logger = getLogger("SERVER");

// 导入配置
const config = require("./config");

const app = express(); // 导入数据库管理器
const dbManager = require("./db/sqlite-manager"); // 引入数据库管理器

// 导入沙箱执行器
const { executeMusicSourceScript } = require("./utils/sandbox-executor");

// ======================== 配置常量 ========================
const CONFIG = {
  // 路径配置
  MUSIC_DIR: path.resolve(__dirname, "music"),
  COVERS_DIR: path.resolve(__dirname, "covers"),
  LYRICS_DIR: path.resolve(__dirname, "lyrics"),
  DATA_DIR: path.resolve(__dirname, "data"),
  AVATARS_DIR: path.resolve(__dirname, "avatars"),
  LOGS_DIR: path.resolve(__dirname, "logs"),

  // 服务器配置（新增）
  PORT: parseInt(process.env.PORT) || 3002, // 更新为3002从环境变量读取，默认3001
  HOST: process.env.HOST || "0.0.0.0", // 从环境变量读取，默认0.0.0.0

  AUTO_CLEANUP_INTERVAL: Math.max(
    parseInt(process.env.CLEANUP_INTERVAL) || 24 * 60 * 60 * 1000,
    60 * 1000, // 最小1分钟，防止设置为0导致死循环
  ),

  // 前端目录（重要！根据实际路径修改）
  // FRONTEND_DIR: path.resolve(__dirname, 'frontend'), // 如果前端在backend目录下
  FRONTEND_DIR: path.resolve(__dirname, "..", "frontend"), // 如果前端在backend同级目录

  // 文件限制
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024,
  MAX_UPLOAD_FILES: parseInt(process.env.MAX_UPLOAD_FILES) || 50,
  MAX_ORPHAN_RECORDS: parseInt(process.env.MAX_ORPHAN_RECORDS) || 20, // 新增：最大孤儿记录数

  // 请求限制
  MAX_REQUEST_SIZE: "10mb",

  // WebSocket 配置
  WEBSOCKET_MAX_CONNECTIONS: parseInt(process.env.WS_MAX_CONNECTIONS) || 100,
  HEARTBEAT_INTERVAL: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
  HEARTBEAT_TIMEOUT: parseInt(process.env.WS_HEARTBEAT_TIMEOUT) || 45000,

  // 限流配置
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 1 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 300,
};

// ======================== 数据库管理 ========================
// 使用 SQLite 数据库管理器，替代了原有的 JSON 文件数据库
// const dbManager = require('./db/sqlite-manager'); // 已在顶部引入

// ======================== 文件安全工具 ========================
const FileSecurity = {
  // ⚠️ 关键修复：将静态属性移到最前面，确保方法调用前已定义
  ALLOWED_AUDIO_EXTENSIONS: [
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".ogg",
    ".m4a",
    ".webm",
    ".mpeg",
    ".opus",
    ".wma",
    ".aiff",
  ],

  ALLOWED_AUDIO_MIME_TYPES: [
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

  /**
   * 解析安全路径，防止路径遍历攻击
   */
  resolveSafePath(baseDir, filename) {
    const normalizedBase = path.normalize(baseDir);
    const resolvedPath = path.resolve(normalizedBase, filename);

    // 防止路径遍历攻击
    if (!resolvedPath.startsWith(normalizedBase)) {
      throw new Error("非法路径访问");
    }
    return resolvedPath;
  },

  /**
   * 生成安全的文件名
   */
  generateSafeFilename(originalName) {
    // 关键修复：添加防御性检查
    if (!originalName || typeof originalName !== "string") {
      throw new Error("无效的文件名");
    }

    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(originalName).toLowerCase();

    // 关键修复：确保数组已定义
    if (!Array.isArray(this.ALLOWED_AUDIO_EXTENSIONS)) {
      logger.error("ALLOWED_AUDIO_EXTENSIONS 未初始化");
      throw new Error("系统配置错误：文件类型白名单未就绪");
    }

    if (!this.ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持的文件类型: ${ext}`);
    }

    return `song_${timestamp}_${randomStr}${ext}`;
  },
};

// ======================== WebSocket 服务器 ========================
class WebSocketServer {
  constructor() {
    this.wss = null;
    this.clients = new Map();
    this.heartbeatInterval = null;
    // 添加播放列表管理
    this.playlists = new Map();
    this.currentSong = null;
    this.isPlaying = false;
  }

  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        logger.error("发送消息失败:", error);
        this.clients.delete(ws);
      }
    }
  }

  broadcastToChannel(channel, data, excludeWs = null) {
    const message = JSON.stringify({
      ...data,
      channel,
      timestamp: new Date().toISOString(),
    });
    let sentCount = 0;
    const invalidConnections = new Set();

    this.clients.forEach((client, ws) => {
      if (
        ws !== excludeWs &&
        ws.readyState === WebSocket.OPEN &&
        client.subscriptions.has(channel)
      ) {
        try {
          ws.send(message);
          sentCount++;
        } catch (error) {
          logger.error("广播消息失败:", error);
          invalidConnections.add(ws);
        }
      }
    });

    // 批量移除无效连接
    invalidConnections.forEach((ws) => this.clients.delete(ws));

    if (sentCount > 0) {
      logger.info(
        `广播到频道 ${channel}: ${data.type}, 发送给 ${sentCount} 个客户端`,
      );
    }

    return sentCount;
  }

  broadcastToAll(data, excludeWs = null) {
    return this.broadcastToChannel("all", data, excludeWs);
  }

  sendPlayEvent(songId, time = 0) {
    this.broadcastToChannel("music_control", {
      type: "music_play",
      data: { songId, time, timestamp: Date.now() },
    });
  }

  sendPauseEvent(songId) {
    this.broadcastToChannel("music_control", {
      type: "music_pause",
      data: { songId, timestamp: Date.now() },
    });
  }

  sendSeekEvent(songId, time) {
    this.broadcastToChannel("music_control", {
      type: "music_seek",
      data: { songId, time, timestamp: Date.now() },
    });
  }

  sendLikeEvent(songId) {
    this.broadcastToChannel("music_control", {
      type: "music_like",
      data: { songId, timestamp: Date.now() },
    });
  }

  requestLyrics(songId) {
    this.broadcastToChannel("music_control", {
      type: "request_lyrics",
      data: { songId },
    });
  }

  init(httpServer) {
    this.wss = new WebSocket.Server({
      server: httpServer,
      maxPayload: 10 * 1024 * 1024,
      clientTracking: true,
    });

    this.setupEventHandlers();
    this.startHeartbeat();

    logger.info("WebSocket 服务器初始化完成");
  }

  setupEventHandlers() {
    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on("error", (error) => {
      logger.error("WebSocket 服务器错误:", error);
    });
  }

  handleConnection(ws, req) {
    if (this.clients.size >= CONFIG.WEBSOCKET_MAX_CONNECTIONS) {
      ws.close(1013, "服务器连接数已满");
      return;
    }

    const clientId = crypto.randomUUID();
    const clientInfo = {
      id: clientId,
      ip: req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      connectedAt: new Date().toISOString(),
      lastHeartbeat: Date.now(),
      subscriptions: new Set(["all"]),
      status: "online",
    };

    this.clients.set(ws, clientInfo);

    logger.info(`客户端连接: ${clientId}, 当前连接数: ${this.clients.size}`);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        clientInfo.lastHeartbeat = Date.now();
        await this.handleMessage(ws, message);
      } catch (error) {
        logger.error(`客户端 ${clientId} 消息解析失败:`, error);
        this.sendToClient(ws, {
          type: "error",
          error: "消息格式错误",
          timestamp: new Date().toISOString(),
        });
      }
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });

    ws.on("error", (error) => {
      logger.error(`客户端 ${clientId} 错误:`, error);
      this.clients.delete(ws);
    });

    this.sendToClient(ws, {
      type: "welcome",
      clientId: clientId,
      message: "连接到音乐服务器成功",
      serverTime: new Date().toISOString(),
      version: "2.0.0",
      maxUploadSize: CONFIG.MAX_FILE_SIZE,
      serverInfo: {
        totalClients: this.clients.size,
        uptime: process.uptime(),
      },
    });

    this.broadcastToChannel(
      "presence",
      {
        type: "user_online",
        data: {
          clientId: clientId,
          timestamp: new Date().toISOString(),
          totalOnline: this.clients.size,
        },
      },
      ws,
    );

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close(1008, "连接超时");
      }
    }, 10000);

    ws.on("open", () => {
      clearTimeout(connectionTimeout);
    });

    ws.on("close", () => {
      clearTimeout(connectionTimeout);
      this.handleDisconnect(ws);
    });
  }

  async handleMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    if (!message.type || typeof message.type !== "string") {
      this.sendToClient(ws, {
        type: "error",
        error: "消息缺少 type 字段",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    switch (message.type) {
      case "ping":
      case "heartbeat":
        this.handlePing(ws);
        break;
      case "subscribe":
      case "join_channel":
        this.handleSubscribe(ws, message);
        break;
      case "music_play":
      case "music_pause":
      case "music_seek":
      case "music_like":
        if (!message.data?.songId) {
          this.sendToClient(ws, {
            type: "error",
            error: "缺少 songId 字段",
            timestamp: new Date().toISOString(),
          });
          return;
        }
        this.broadcastToChannel(
          "music_control",
          {
            type: message.type,
            data: message.data,
            from: client.id,
            timestamp: new Date().toISOString(),
          },
          ws,
        );
        break;
      case "chat_message":
        if (!message.data?.text || typeof message.data.text !== "string") {
          this.sendToClient(ws, {
            type: "error",
            error: "消息内容无效",
            timestamp: new Date().toISOString(),
          });
          return;
        }
        if (message.data.text.length > 500) {
          this.sendToClient(ws, {
            type: "error",
            error: "消息长度超过限制",
            timestamp: new Date().toISOString(),
          });
          return;
        }
        this.handleChatMessage(ws, message);
        break;
      case "typing":
        this.broadcastToChannel(
          "chat",
          {
            type: "user_typing",
            data: {
              clientId: client.id,
              isTyping: !!message.data?.isTyping,
            },
          },
          ws,
        );
        break;
      case "get_playlist":
        this.handleGetPlaylist(ws, message);
        break;
      case "add_to_playlist":
        this.handleAddToPlaylist(ws, message);
        break;
      case "remove_from_playlist":
        this.handleRemoveFromPlaylist(ws, message);
        break;
      case "play_next":
        this.handlePlayNext(ws);
        break;
      case "play_previous":
        this.handlePlayPrevious(ws);
        break;
      default:
        this.sendToClient(ws, {
          type: "error",
          error: "未知的消息类型",
          receivedType: message.type,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  handlePing(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    client.lastHeartbeat = Date.now();

    this.sendToClient(ws, {
      type: "pong",
      timestamp: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    });
  }

  handleSubscribe(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    if (message.channel) {
      client.subscriptions.add(message.channel);
      logger.info(`客户端 ${client.id} 订阅了频道: ${message.channel}`);

      this.sendToClient(ws, {
        type: "subscription_confirmed",
        channel: message.channel,
        timestamp: new Date().toISOString(),
      });
    }
  }

  handleChatMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client || !message.data?.text) return;

    // 转义HTML特殊字符
    const escapeHtml = (text) => {
      const map = {
        "&": "&",
        "<": "<",
        ">": ">",
        '"': '"',
        "'": "&#039;",
      };
      return text.replace(/[&<>"']/g, (m) => map[m]);
    };

    const chatMessage = {
      id: crypto.randomUUID(),
      clientId: client.id,
      text: escapeHtml(message.data.text),
      timestamp: new Date().toISOString(),
      type: "chat",
    };

    this.broadcastToChannel(
      "chat",
      {
        type: "chat_message",
        data: chatMessage,
      },
      ws,
    );
  }

  handleDisconnect(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    const currentSize = this.clients.size;
    logger.info(`客户端断开: ${client.id}, 剩余连接数: ${currentSize - 1}`);

    this.clients.delete(ws);

    // 只有在还有其他客户端时才广播离线消息
    if (this.clients.size > 0) {
      this.broadcastToChannel("presence", {
        type: "user_offline",
        data: {
          clientId: client.id,
          timestamp: new Date().toISOString(),
          totalOnline: this.clients.size,
        },
      });
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const invalidConnections = new Set();

      this.clients.forEach((client, ws) => {
        if (now - client.lastHeartbeat > CONFIG.HEARTBEAT_TIMEOUT) {
          logger.warn(`客户端心跳超时: ${client.id}`);
          ws.terminate();
          invalidConnections.add(ws);
        }
      });

      // 批量移除无效连接
      invalidConnections.forEach((ws) => this.clients.delete(ws));

      this.clients.forEach((client, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  close() {
    this.stopHeartbeat();
    this.clients.forEach((client, ws) => {
      ws.close(1000, "服务器关闭");
    });
    this.clients.clear();
  }

  handleGetPlaylist(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    const playlistId = message.data?.playlistId || "default";
    const playlist = this.playlists.get(playlistId) || [];

    this.sendToClient(ws, {
      type: "playlist_response",
      data: {
        playlistId,
        songs: Array.isArray(playlist) ? playlist : [],
        currentSong: this.currentSong,
        isPlaying: this.isPlaying,
      },
      timestamp: new Date().toISOString(),
    });
  }

  handleAddToPlaylist(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    if (!message.data?.song) {
      this.sendToClient(ws, {
        type: "error",
        error: "缺少歌曲信息",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const playlistId = message.data.playlistId || "default";
    const playlist = this.playlists.get(playlistId) || [];

    // 验证歌曲数据
    const song = {
      id: message.data.song.id,
      title: message.data.song.title || "未知歌曲",
      artist: message.data.song.artist || "未知艺术家",
      duration: message.data.song.duration || 0,
      url: message.data.song.url,
      addedAt: new Date().toISOString(),
      addedBy: client.id,
    };

    playlist.push(song);
    this.playlists.set(playlistId, playlist);

    this.broadcastToChannel("playlist", {
      type: "playlist_updated",
      data: {
        playlistId,
        songs: playlist,
        action: "add",
        song,
      },
    });

    this.sendToClient(ws, {
      type: "add_to_playlist_success",
      data: {
        playlistId,
        song,
      },
      timestamp: new Date().toISOString(),
    });
  }

  handleRemoveFromPlaylist(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    if (!message.data?.songId) {
      this.sendToClient(ws, {
        type: "error",
        error: "缺少歌曲ID",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const playlistId = message.data.playlistId || "default";
    const playlist = this.playlists.get(playlistId) || [];

    const songIndex = playlist.findIndex(
      (song) => song.id === message.data.songId,
    );
    if (songIndex === -1) {
      this.sendToClient(ws, {
        type: "error",
        error: "歌曲不存在",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const removedSong = playlist.splice(songIndex, 1)[0];
    this.playlists.set(playlistId, playlist);

    // 如果删除的是当前播放的歌曲
    if (this.currentSong?.id === removedSong.id) {
      this.currentSong = null;
      this.isPlaying = false;
    }

    this.broadcastToChannel("playlist", {
      type: "playlist_updated",
      data: {
        playlistId,
        songs: playlist,
        action: "remove",
        songId: removedSong.id,
        currentSong: this.currentSong,
        isPlaying: this.isPlaying,
      },
    });

    this.sendToClient(ws, {
      type: "remove_from_playlist_success",
      data: {
        playlistId,
        songId: removedSong.id,
      },
      timestamp: new Date().toISOString(),
    });
  }

  handlePlayNext(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    const playlist = this.playlists.get("default") || [];
    if (!Array.isArray(playlist) || playlist.length === 0) {
      this.sendToClient(ws, {
        type: "error",
        error: "播放列表为空",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const currentIndex = this.currentSong
      ? playlist.findIndex((song) => song.id === this.currentSong.id)
      : -1;

    const nextIndex = (currentIndex + 1) % playlist.length;
    this.currentSong = playlist[nextIndex];
    this.isPlaying = true;

    this.broadcastToChannel("music_control", {
      type: "music_play",
      data: {
        song: this.currentSong,
        timestamp: Date.now(),
      },
    });
  }

  handlePlayPrevious(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    const playlist = this.playlists.get("default") || [];
    if (!Array.isArray(playlist) || playlist.length === 0) {
      this.sendToClient(ws, {
        type: "error",
        error: "播放列表为空",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const currentIndex = this.currentSong
      ? playlist.findIndex((song) => song.id === this.currentSong.id)
      : -1;

    const prevIndex =
      currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
    this.currentSong = playlist[prevIndex];
    this.isPlaying = true;

    this.broadcastToChannel("music_control", {
      type: "music_play",
      data: {
        song: this.currentSong,
        timestamp: Date.now(),
      },
    });
  }
}

const wsServer = new WebSocketServer();

// ======================== Express 中间件 ========================
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    config.NODE_ENV === "production"
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:"
      : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; font-src 'self' https://cdnjs.cloudflare.com; media-src 'self' blob:; connect-src 'self' ws://localhost:3000 wss://localhost:3000 https://cdn.jsdelivr.net",
  );
  next();
});

app.use(
  cors({
    origin: config.NODE_ENV === "production" ? false : true,
    credentials: true,
  }),
);

const apiLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW,
  max: CONFIG.RATE_LIMIT_MAX,
  message: { error: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ======================== 静态文件服务（关键修复） ========================
// 提供前端静态文件
app.use(
  express.static(CONFIG.FRONTEND_DIR, {
    index: "index.html",
    dotfiles: "deny",
    cacheControl: true,
    maxAge: config.NODE_ENV === "production" ? "1d" : 0,
  }),
);

app.use(express.static("public"));

// ======================== API 路由 ========================
// 找到 app.get('/api/music', ...) 并替换

app.get("/api/music", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    // ✅ 使用 SQLiteManager 的方法
    const songs = dbManager.getAllSongs();
    const paginated = songs.slice(offset, offset + limit);

    res.json({
      songs: paginated,
      pagination: {
        total: songs.length,
        page,
        limit,
        pages: Math.ceil(songs.length / limit),
      },
    });
  } catch (error) {
    logger.error("获取音乐库失败:", error);
    res.status(500).json({
      error: "获取音乐库失败",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.get("/api/music/:id", async (req, res) => {
  try {
    const songs = dbManager.getAllSongs();
    const song = songs.find((s) => s.id === req.params.id);

    if (!song) {
      return res.status(404).json({ error: "歌曲不存在" });
    }

    res.json(song);
  } catch (error) {
    logger.error("获取音乐信息失败:", error);
    res.status(500).json({ error: "获取音乐信息失败" });
  }
});

// 添加每日推荐接口
// 找到 app.get('/api/recommendations/daily', ...) 并替换

app.get("/api/recommendations/daily", async (req, res) => {
  try {
    const songs = dbManager.getAllSongs();

    // ✅ 如果没有歌曲，返回空数组
    if (!songs || songs.length === 0) {
      return res.json({ recommendations: [] });
    }

    // 简单推荐逻辑：随机选择最多6首歌
    const shuffled = [...songs].sort(() => 0.5 - Math.random());
    const recommendations = shuffled.slice(0, Math.min(6, songs.length));

    res.json({ recommendations });
  } catch (error) {
    logger.error("获取每日推荐失败:", error);
    res.status(500).json({
      error: "获取每日推荐失败",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ======================== 上传中间件 ========================
const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        // 确保目录存在
        await fs.mkdir(CONFIG.MUSIC_DIR, { recursive: true });
        cb(null, CONFIG.MUSIC_DIR);
      } catch (error) {
        logger.error("创建音乐目录失败:", error);
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      try {
        // 防御性检查
        if (!file || !file.originalname) {
          throw new Error("无效的文件对象");
        }

        const filename = FileSecurity.generateSafeFilename(file.originalname);
        logger.info(`文件上传: ${file.originalname} -> ${filename}`);
        cb(null, filename);
      } catch (error) {
        logger.error("生成文件名失败:", error);
        cb(error);
      }
    },
  }),
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
    files: CONFIG.MAX_UPLOAD_FILES,
  },
  fileFilter: async (req, file, cb) => {
    try {
      // 防御性检查
      if (
        !FileSecurity.ALLOWED_AUDIO_MIME_TYPES ||
        !Array.isArray(FileSecurity.ALLOWED_AUDIO_MIME_TYPES)
      ) {
        logger.error("ALLOWED_AUDIO_MIME_TYPES 未初始化");
        return cb(new Error("系统配置错误"));
      }

      const mimetype = (file.mimetype || "").toLowerCase();
      const originalName = file.originalname || "";

      // 优先检查 MIME 类型
      if (FileSecurity.ALLOWED_AUDIO_MIME_TYPES.includes(mimetype)) {
        return cb(null, true);
      }

      // MIME 检查失败时，通过扩展名判断（兼容某些浏览器）
      const ext = path.extname(originalName).toLowerCase().substring(1);
      const extToMime = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        flac: "audio/flac",
        aac: "audio/aac",
        ogg: "audio/ogg",
        m4a: "audio/mp4",
        webm: "audio/webm",
        mpeg: "audio/mpeg",
      };

      if (
        extToMime[ext] &&
        FileSecurity.ALLOWED_AUDIO_MIME_TYPES.includes(extToMime[ext])
      ) {
        logger.debug(`通过扩展名 ${ext} 允许文件: ${originalName}`);
        return cb(null, true);
      }

      logger.error(`文件类型被拒绝: ${mimetype}, 文件名: ${originalName}`);
      return cb(new Error(`不支持的文件类型: ${mimetype}`));
    } catch (error) {
      logger.error("文件过滤器错误:", error);
      cb(error);
    }
  },
});

app.post("/api/upload", uploadMiddleware.single("music"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "没有上传文件" });
    }

    const originalName = req.file.originalname;
    const savedName = req.file.filename;
    const filePath = req.file.path;

    logger.info(`文件上传: ${originalName} -> ${savedName}`);

    const fileHash = await audioProcessor.calculateHash(filePath);

    // 检查重复（使用数据库查询）
    const duplicate = dbManager.getSongByFileHash(fileHash);
    if (duplicate) {
      await fs.unlink(filePath);
      return res.status(409).json({
        error: "文件已存在",
        existingSong: {
          id: duplicate.id,
          title: duplicate.title,
          artist: duplicate.artist,
        },
      });
    }

    const metadata = await audioProcessor.extractMetadata(filePath);
    const fileInfo = audioProcessor.parseFromFilename(originalName);

    const song = {
      id: crypto.randomUUID(),
      filename: savedName,
      originalFilename: originalName,
      title: metadata.title || fileInfo.title,
      artist: metadata.artist || fileInfo.artist,
      album: metadata.album || fileInfo.album,
      year: metadata.year,
      genre: metadata.genre,
      duration: metadata.duration || 0,
      format:
        metadata.format?.toUpperCase() ||
        path.extname(savedName).substring(1).toUpperCase(),
      filePath: filePath,
      fileUrl: `/api/stream/${encodeURIComponent(savedName)}`,
      fileHash: fileHash,
      fileSize: req.file.size,
      coverUrl: null,
      lyricFile: null,
      uploadDate: new Date().toISOString(),
      playCount: 0,
    };

    if (metadata.picture && metadata.picture.length > 0) {
      try {
        const coverName = `cover_${song.id}.jpg`;
        const coverPath = path.join(CONFIG.COVERS_DIR, coverName);
        await fs.writeFile(coverPath, metadata.picture[0].data);
        song.coverUrl = `/api/covers/${coverName}`;
        logger.info(`提取封面: ${coverName}`);
      } catch (error) {
        logger.warn("提取封面失败:", error.message);
      }
    }

    if (metadata.lyrics && metadata.lyrics.length > 0) {
      try {
        const lyricName = `lyric_${song.id}.lrc`;
        const lyricPath = path.join(CONFIG.LYRICS_DIR, lyricName);
        await fs.writeFile(lyricPath, metadata.lyrics[0], "utf8");
        song.lyricFile = lyricName;
        logger.info(`提取歌词: ${lyricName}`);
      } catch (error) {
        logger.warn("提取歌词失败:", error.message);
      }
    }

    // 将新歌曲添加到数据库
    // songs.push(song);
    // await dbManager.saveSongs(songs);

    dbManager.addSong(song);

    // 添加新歌曲
    // currentSongs.push(song);
    // // 写入
    // await dbManager.write({ ...currentDb, songs: currentSongs });

    logger.info(`音乐上传成功: ${song.title} - ${song.artist}`);

    wsServer.broadcastToAll({
      type: "music_uploaded",
      data: {
        songId: song.id,
        title: song.title,
        artist: song.artist,
      },
    });

    res.json({ success: true, song: song, message: "文件上传成功" });
  } catch (error) {
    logger.error("上传处理失败:", error);
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: "处理文件时发生错误" });
  }
});

// 自动识别并更新歌曲信息接口

app.post("/api/music/:id/identify", async (req, res) => {
  try {
    const song = await dbManager.getSongById(req.params.id);

    if (!song) return res.status(404).json({ error: "歌曲不存在" });

    const filePath = song.filePath;

    if (!filePath) {
      return res.status(400).json({ error: "文件路径无效" });
    }

    // 检查文件是否存在
    if (!(await dbManager.fileExists(filePath))) {
      return res.status(404).json({ error: "音频文件不存在" });
    }

    // 调用元数据服务
    const metadata = await metadataService.identifySong(filePath, {
      title: song.title,
      artist: song.artist,
      displayName: path.basename(song.filename, path.extname(song.filename)),
    });

    if (metadata) {
      const updates = {
        title: metadata.title || song.title,
        artist: metadata.artist || song.artist,
        album: metadata.album || song.album,
      };

      if (metadata.year) updates.year = metadata.year;

      // 下载并保存封面
      if (metadata.coverUrl) {
        try {
          const coverRes = await axios.get(metadata.coverUrl, {
            responseType: "arraybuffer",
          });
          const coverName = `cover_${song.id}_auto.jpg`;
          const coverPath = path.join(CONFIG.COVERS_DIR, coverName);
          await fs.writeFile(coverPath, coverRes.data);

          // 删除旧封面（如果不是默认封面）
          if (song.coverUrl && !song.coverUrl.includes("default")) {
            const oldCoverName = song.coverUrl.replace("/api/covers/", "");
            const oldCoverPath = FileSecurity.resolveSafePath(
              CONFIG.COVERS_DIR,
              oldCoverName,
            );
            await fs.unlink(oldCoverPath).catch(() => {});
          }

          updates.coverUrl = `/api/covers/${coverName}`;
        } catch (e) {
          logger.error("封面下载失败:", e.message);
        }
      }

      // 保存更新
      dbManager.updateSong(song.id, updates);

      // 广播更新
      wsServer.broadcastToAll({
        type: "music_updated",
        data: { id: song.id, ...updates },
      });

      return res.json({
        success: true,
        song: { ...song, ...updates },
        source: metadata.source,
      });
    } else {
      return res.status(404).json({ error: "未找到匹配的在线信息" });
    }
  } catch (error) {
    logger.error("自动识别失败:", error);
    res.status(500).json({
      error: "识别过程出错",
      details: error.message,
    });
  }
});

app.get("/api/stream/:filename", (req, res) => {
  const requestId = Date.now() + "_" + Math.random().toString(16).slice(2, 8);

  const log = (...args) => {
    logger.info(`STREAM ${requestId}:`, ...args);
  };

  const error = (...args) => {
    logger.error(`STREAM ${requestId}:`, ...args);
  };

  try {
    const filename = req.params.filename;
    log("请求文件:", filename);
    log("Range:", req.headers.range || "无");

    // ========= 1️⃣ 参数校验 =========
    if (!filename) {
      error("filename 为空");
      return res.status(400).json({ error: "INVALID_FILENAME" });
    }

    if (filename.includes("..")) {
      error("检测到路径穿越:", filename);
      return res.status(400).json({ error: "PATH_TRAVERSAL_DETECTED" });
    }

    const filePath = path.join(CONFIG.MUSIC_DIR, filename);
    log("真实路径:", filePath);

    // ========= 2️⃣ 文件存在性 =========
    if (!fsSync.existsSync(filePath)) {
      error("文件不存在");
      return res.status(404).json({ error: "FILE_NOT_FOUND" });
    }

    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) {
      error("不是文件");
      return res.status(400).json({ error: "NOT_A_FILE" });
    }

    const fileSize = stat.size;
    log("文件大小:", fileSize);

    // ========= 3️⃣ MIME 类型 =========
    const ext = path.extname(filename).toLowerCase();
    const mimeMap = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".flac": "audio/flac",
    };

    const contentType = mimeMap[ext];
    if (!contentType) {
      error("不支持的音频格式:", ext);
      return res.status(415).json({
        error: "UNSUPPORTED_MEDIA_TYPE",
        ext,
      });
    }

    // ========= 4️⃣ 通用响应头 =========
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = req.headers.range;

    // ========= 5️⃣ Range 处理 =========
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);

      if (!match) {
        error("非法 Range Header:", range);
        return res.status(416).json({ error: "INVALID_RANGE_HEADER" });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end)) {
        error("Range 解析失败:", { start, end });
        return res.status(416).json({ error: "RANGE_PARSE_FAILED" });
      }

      if (start >= fileSize || end >= fileSize) {
        error("Range 越界:", { start, end, fileSize });
        return res.status(416).json({ error: "RANGE_OUT_OF_BOUNDS" });
      }

      const chunkSize = end - start + 1;

      log("发送 Range:", { start, end, chunkSize });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunkSize,
      });

      const stream = fsSync.createReadStream(filePath, { start, end });

      stream.on("open", () => {
        log("文件流已打开");
      });

      stream.on("error", (error) => {
        error("文件流读取失败:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "STREAM_READ_ERROR" });
        }
        res.end();
      });

      res.on("close", () => {
        log("客户端关闭连接 (Range)");
        stream.destroy();
      });

      stream.pipe(res);
    } else {
      // ========= 6️⃣ 非 Range（兜底） =========
      log("无 Range，发送完整文件");

      res.writeHead(200, {
        "Content-Length": fileSize,
      });

      const stream = fsSync.createReadStream(filePath);

      stream.on("open", () => {
        log("完整文件流已打开");
      });

      stream.on("error", (error) => {
        error("完整流读取失败:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "STREAM_READ_ERROR" });
        }
        res.end();
      });

      res.on("close", () => {
        log("客户端关闭连接 (full)");
        stream.destroy();
      });

      stream.pipe(res);
    }
  } catch (err) {
    error("未捕获异常:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "INTERNAL_STREAM_ERROR",
        message: err.message,
      });
    }
  }
});

// ======================== 歌词相关API接口 ========================

// 获取歌词（修复版）
app.get("/api/lyrics/:id", async (req, res) => {
  try {
    const song = await dbManager.getSongById(req.params.id);

    if (!song) {
      return res.status(404).json({ error: "歌曲不存在" });
    }

    // 如果已有歌词文件，直接返回
    if (song.lyricFile) {
      try {
        const lyricPath = FileSecurity.resolveSafePath(
          CONFIG.LYRICS_DIR,
          song.lyricFile,
        );

        // 检查歌词文件是否存在
        const exists = await dbManager.fileExists(lyricPath);
        if (exists) {
          const lyrics = await fs.readFile(lyricPath, "utf8");
          return res.json({ id: song.id, lyrics });
        }
      } catch (fileError) {
        logger.warn("读取本地歌词文件失败:", fileError.message);
      }
    }

    // 本地没有歌词文件，尝试从网络获取
    logger.debug(
      `本地未找到歌词，尝试从网络获取: ${song.title} - ${song.artist}`,
    );
    const lyrics = await utils.fetchLyricsFromWeb(song.title, song.artist);

    if (lyrics) {
      // 保存获取到的歌词到本地
      const lyricName = `lyric_${song.id}.lrc`;
      const lyricPath = path.join(CONFIG.LYRICS_DIR, lyricName);
      await fs.writeFile(lyricPath, lyrics, "utf8");

      // 更新数据库中的歌词文件路径
      await dbManager.updateSongLyrics(song.id, lyricName);

      logger.info(`成功从网络获取并保存歌词: ${song.title}`);
      return res.json({ id: song.id, lyrics });
    }

    // 本地和网络都没有找到歌词
    return res.json({ id: song.id, lyrics: "" });
  } catch (error) {
    logger.error("获取歌词失败:", error);
    res.status(500).json({
      error: "获取歌词失败",
      details: error.message,
    });
  }
});

// ======================== 歌词相关API接口 ========================

// 1. 批量获取歌词接口
app.post("/api/lyrics/batch-fetch", async (req, res) => {
  try {
    const { songIds } = req.body;

    if (!songIds || !Array.isArray(songIds)) {
      return res.status(400).json({ error: "需要提供歌曲ID数组" });
    }

    const songs = dbManager.getAllSongs();
    const targetSongs = songs.filter((song) => songIds.includes(song.id));

    if (targetSongs.length === 0) {
      return res.status(404).json({ error: "未找到指定的歌曲" });
    }

    // 设置响应头为流式输出
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");
    res.write('{"status": "started", "total": ' + targetSongs.length + "}\n");

    // 添加超时处理
    req.setTimeout(300000); // 5分钟超时

    // 实时推送进度
    const results = await utils.batchFetchLyrics(targetSongs, (progress) => {
      res.write(JSON.stringify({ type: "progress", data: progress }) + "\n");
    });

    // 批量更新数据库中的歌词信息
    const songsWithLyrics = songs.filter((song) => song.lyricFile);
    if (songsWithLyrics.length > 0) {
      // 使用事务批量更新，提高性能和保证数据一致性
      dbManager.db.transaction((songsToUpdate) => {
        const stmt = dbManager.db.prepare(
          "UPDATE songs SET lyric_file = ? WHERE id = ?",
        );
        for (const song of songsToUpdate) {
          if (song.lyricFile) {
            stmt.run(song.lyricFile, song.id);
          }
        }
      })(songsWithLyrics);
    }

    res.write(JSON.stringify({ type: "complete", data: results }) + "\n");
    res.end();
  } catch (error) {
    logger.error("批量获取歌词失败:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "批量获取歌词失败", details: error.message });
    }
  }
});

// 2. 歌词搜索建议接口
app.get("/api/lyrics/suggestions", async (req, res) => {
  try {
    const { title, artist } = req.query;

    if (!title) {
      return res.json({ suggestions: [] });
    }

    const songs = dbManager.getAllSongs();

    // 本地搜索相似歌曲
    const suggestions = songs
      .filter((song) => {
        if (!song.title) return false;
        return song.title.toLowerCase().includes(title.toLowerCase());
      })
      .slice(0, 10)
      .map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        hasLyrics: !!song.lyricFile,
      }));

    res.json({ suggestions });
  } catch (error) {
    logger.error("获取歌词建议失败:", error);
    res.status(500).json({ error: "获取歌词建议失败" });
  }
});

// 3. 歌词统计接口
app.get("/api/lyrics/stats", async (req, res) => {
  try {
    const songs = dbManager.getAllSongs();

    let withLyrics = 0;
    let withoutLyrics = 0;
    const artistsWithLyrics = new Set();
    const artistsWithoutLyrics = new Set();

    songs.forEach((song) => {
      if (song.lyricFile) {
        withLyrics++;
        if (song.artist) artistsWithLyrics.add(song.artist);
      } else {
        withoutLyrics++;
        if (song.artist) artistsWithoutLyrics.add(song.artist);
      }
    });

    // 获取歌词目录大小
    let lyricsDirSize = 0;
    try {
      const files = await fs.readdir(CONFIG.LYRICS_DIR);
      for (const file of files) {
        const filePath = path.join(CONFIG.LYRICS_DIR, file);
        const stats = await fs.stat(filePath);
        lyricsDirSize += stats.size;
      }
    } catch (error) {
      logger.warn("获取歌词目录大小失败:", error.message);
    }

    res.json({
      totalSongs: songs.length,
      withLyrics: {
        count: withLyrics,
        percentage:
          songs.length > 0 ? Math.round((withLyrics / songs.length) * 100) : 0,
        artists: artistsWithLyrics.size,
      },
      withoutLyrics: {
        count: withoutLyrics,
        percentage:
          songs.length > 0
            ? Math.round((withoutLyrics / songs.length) * 100)
            : 0,
        artists: artistsWithoutLyrics.size,
      },
      lyricsDirectory: {
        size: lyricsDirSize,
        sizeFormatted: utils.formatFileSize(lyricsDirSize),
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("获取歌词统计失败:", error);
    res.status(500).json({ error: "获取歌词统计失败" });
  }
});

// 4. 歌词文件直接下载接口
app.get("/api/lyrics/:id/download", async (req, res) => {
  try {
    const songs = dbManager.getAllSongs();
    const song = songs.find((s) => s.id === req.params.id);

    if (!song) {
      return res.status(404).json({ error: "歌曲不存在" });
    }

    if (!song.lyricFile) {
      return res.status(404).json({ error: "歌曲没有歌词" });
    }

    const lyricPath = FileSecurity.resolveSafePath(
      CONFIG.LYRICS_DIR,
      song.lyricFile,
    );

    if (!(await dbManager.fileExists(lyricPath))) {
      return res.status(404).json({ error: "歌词文件不存在" });
    }

    // 设置下载头
    const filename = `${song.title} - ${song.artist}.lrc`;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    const fileStream = fs.createReadStream(lyricPath);
    fileStream.pipe(res);

    fileStream.on("error", (error) => {
      logger.error("下载歌词文件失败:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "下载歌词文件失败" });
      }
    });
  } catch (error) {
    logger.error("下载歌词失败:", error);
    res.status(500).json({ error: "下载歌词失败" });
  }
});

// 找到 app.get('/api/covers/:filename', ...) 并替换

app.get("/api/covers/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;

    // ✅ 安全检查：防止路径穿越
    if (!filename || filename.includes("..")) {
      return res.status(400).json({ error: "无效的文件名" });
    }

    const coverPath = path.join(CONFIG.COVERS_DIR, filename);

    // 检查文件是否存在
    try {
      await fs.access(coverPath);
      return res.sendFile(coverPath);
    } catch (e) {
      // 文件不存在，返回默认封面
      const defaultCover = path.join(CONFIG.COVERS_DIR, "default.png");
      return res.sendFile(defaultCover);
    }
  } catch (error) {
    logger.error("获取封面失败:", error);
    res.status(500).json({
      error: "获取封面失败",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    if (!query) {
      return res.json({ results: [] });
    }

    const songs = dbManager.getAllSongs();
    const results = songs.filter((song) => {
      const searchText =
        `${song.title} ${song.artist} ${song.album}`.toLowerCase();
      return searchText.includes(query.toLowerCase());
    });

    res.json({ results });
  } catch (error) {
    logger.error("搜索失败:", error);
    res.status(500).json({ error: "搜索失败" });
  }
});

app.delete("/api/music/:id", async (req, res) => {
  try {
    const songs = dbManager.getAllSongs();
    const songIndex = songs.findIndex((s) => s.id === req.params.id);

    if (songIndex === -1) {
      return res.status(404).json({ error: "歌曲不存在" });
    }

    const song = songs[songIndex];

    // 删除所有关联文件
    if (song.filePath) {
      await fs.unlink(song.filePath).catch(() => {});
    }
    if (song.lyricFile) {
      const lyricPath = FileSecurity.resolveSafePath(
        CONFIG.LYRICS_DIR,
        song.lyricFile,
      );
      await fs.unlink(lyricPath).catch(() => {});
    }
    if (song.coverUrl) {
      const coverName = song.coverUrl.replace("/api/covers/", "");
      const coverPath = FileSecurity.resolveSafePath(
        CONFIG.COVERS_DIR,
        coverName,
      );
      await fs.unlink(coverPath).catch(() => {});
    }

    // songs.splice(songIndex, 1);
    // await dbManager.saveSongs(songs);

    dbManager.deleteSong(req.params.id);

    wsServer.broadcastToAll({
      type: "music_deleted",
      data: { songId: song.id, title: song.title, artist: song.artist },
    });

    res.json({
      success: true,
      message: "歌曲已删除",
      deletedSong: { id: song.id, title: song.title, artist: song.artist },
    });
  } catch (error) {
    logger.error("删除音乐失败:", error);
    res.status(500).json({ error: "删除音乐失败" });
  }
});

// 音乐库重新扫描端点
app.post("/api/rescan", async (req, res) => {
  try {
    logger.info("开始重新扫描音乐库...");

    // 确保音乐目录存在
    await fs.mkdir(CONFIG.MUSIC_DIR, { recursive: true });

    // 获取音乐目录中的所有文件
    const files = await fs.readdir(CONFIG.MUSIC_DIR);
    const audioFiles = files.filter((file) =>
      FileSecurity.ALLOWED_AUDIO_EXTENSIONS.includes(
        path.extname(file).toLowerCase(),
      ),
    );

    logger.info(`找到 ${audioFiles.length} 个音频文件`);

    // 获取数据库中的所有歌曲
    const existingSongs = dbManager.getAllSongs();
    const existingFiles = new Set(existingSongs.map((song) => song.filename));

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    // 处理每个音频文件
    for (const filename of audioFiles) {
      // 如果文件已经存在于数据库中，跳过
      if (existingFiles.has(filename)) {
        continue;
      }

      const filePath = path.join(CONFIG.MUSIC_DIR, filename);

      try {
        // 计算文件哈希
        const fileHash = await calculateFileHash(filePath);

        // 提取元数据
        const metadata = await audioProcessor.extractMetadata(filePath);
        const fileInfo = audioProcessor.parseFromFilename(filename);

        // 创建新歌曲对象
        const newSong = {
          id: crypto.randomUUID(),
          filename: filename,
          originalFilename: filename,
          title: metadata.title || fileInfo.title,
          artist: metadata.artist || fileInfo.artist,
          album: metadata.album || fileInfo.album,
          year: metadata.year,
          genre: metadata.genre,
          duration: metadata.duration || 0,
          format:
            metadata.format?.toUpperCase() ||
            path.extname(filename).substring(1).toUpperCase(),
          filePath: filePath,
          fileUrl: `/api/stream/${encodeURIComponent(filename)}`,
          fileHash: fileHash,
          fileSize: (await fs.stat(filePath)).size,
          coverUrl: null,
          lyricFile: null,
          uploadDate: new Date().toISOString(),
          playCount: 0,
        };

        // 提取封面
        if (metadata.picture && metadata.picture.length > 0) {
          try {
            const coverName = `cover_${newSong.id}.jpg`;
            const coverPath = path.join(CONFIG.COVERS_DIR, coverName);
            await fs.writeFile(coverPath, metadata.picture[0].data);
            newSong.coverUrl = `/api/covers/${coverName}`;
          } catch (error) {
            logger.warn("提取封面失败:", error.message);
          }
        }

        // 提取歌词
        if (metadata.lyrics && metadata.lyrics.length > 0) {
          try {
            const lyricName = `lyric_${newSong.id}.lrc`;
            const lyricPath = path.join(CONFIG.LYRICS_DIR, lyricName);
            await fs.writeFile(lyricPath, metadata.lyrics[0], "utf8");
            newSong.lyricFile = lyricName;
          } catch (error) {
            logger.warn("提取歌词失败:", error.message);
          }
        }

        // 添加到数据库
        dbManager.addSong(newSong);
        addedCount++;

        // 广播添加事件
        wsServer.broadcastToAll({
          type: "music_uploaded",
          data: {
            songId: newSong.id,
            title: newSong.title,
            artist: newSong.artist,
          },
        });

        logger.info(`添加新歌曲: ${newSong.title} - ${newSong.artist}`);
      } catch (error) {
        logger.error(`处理文件 ${filename} 时出错:`, error);
      }
    }

    // 删除数据库中存在但文件系统中不存在的记录
    const existingFilenames = new Set(audioFiles);
    for (const song of existingSongs) {
      if (!existingFilenames.has(song.filename)) {
        // 删除所有关联文件
        if (song.filePath) {
          await fs.unlink(song.filePath).catch(() => {});
        }
        if (song.lyricFile) {
          const lyricPath = FileSecurity.resolveSafePath(
            CONFIG.LYRICS_DIR,
            song.lyricFile,
          );
          await fs.unlink(lyricPath).catch(() => {});
        }
        if (song.coverUrl) {
          const coverName = song.coverUrl.replace("/api/covers/", "");
          const coverPath = FileSecurity.resolveSafePath(
            CONFIG.COVERS_DIR,
            coverName,
          );
          await fs.unlink(coverPath).catch(() => {});
        }

        // 从数据库中删除
        dbManager.deleteSong(song.id);
        deletedCount++;

        // 广播删除事件
        wsServer.broadcastToAll({
          type: "music_deleted",
          data: {
            songId: song.id,
            title: song.title,
            artist: song.artist,
          },
        });

        logger.info(`删除不存在的歌曲: ${song.title} - ${song.artist}`);
      }
    }

    logger.info(
      `音乐库扫描完成: 添加 ${addedCount} 首, 更新 ${updatedCount} 首, 删除 ${deletedCount} 首`,
    );

    res.json({
      success: true,
      message: "音乐库扫描完成",
      statistics: {
        totalFiles: audioFiles.length,
        added: addedCount,
        updated: updatedCount,
        deleted: deletedCount,
      },
    });
  } catch (error) {
    logger.error("重新扫描音乐库失败:", error);
    res.status(500).json({ error: "扫描过程中发生错误" });
  }
});

// 辅助函数：计算文件哈希
async function calculateFileHash(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fsSync.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// 找到 app.get('/api/stats', ...)

app.get("/api/stats", async (req, res) => {
  try {
    // ✅ 使用 SQLiteManager 的统计方法
    const stats = dbManager.getStats();

    // 获取唯一艺术家数量
    const artistsStmt = dbManager.db.prepare(
      "SELECT COUNT(DISTINCT artist) as count FROM songs",
    );
    const artistsResult = artistsStmt.get();

    res.json({
      totalSongs: stats.totalSongs,
      totalArtists: artistsResult.count,
      totalDuration: stats.totalDuration,
      totalSize: stats.totalSize,
      totalSizeMB: stats.totalSizeMB,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("获取统计信息失败:", error);
    res.status(500).json({
      error: "获取统计信息失败",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// 测试用音乐源导入API端点（本地文件）
app.post("/api/music-source/test-local", async (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");

    // 从请求体获取文件路径
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({
        error: "参数错误",
        message: "必须提供filePath参数",
      });
    }

    // 确保使用正确的路径处理方式，避免中文文件名编码问题
    const fullPath = path.join(__dirname, filePath);
    console.log("处理后的文件路径:", fullPath);

    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: "文件不存在",
        message: `文件不存在: ${fullPath}`,
      });
    }

    // 读取指定的本地测试文件
    const content = fs.readFileSync(fullPath, "utf8");
    let songs = [];

    // 使用vm模块来安全地执行JS代码
    const vm = require("vm");

    // 创建lx对象
    const lxObj = {
      version: "1.0.0",
      api: {},
      app: {},
      utils: {},
      data: {},
      event: {},
      cache: {},
      store: {},
      settings: {},
      currentScriptInfo: {
        name: path.basename(filePath, ".js"),
        id: path
          .basename(filePath, ".js")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
        type: "music",
      },
      utils: {},
      // 添加request属性（既可以作为函数调用，又可以作为对象使用）
      request: Object.assign(
        function (options, callback) {
          logger.debug("lx.request作为函数调用:", options.url || options);
          if (typeof callback === "function") {
            callback(null, {
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          } else {
            logger.debug("lx.request: callback不是函数，返回Promise");
            return Promise.resolve({
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          }
        },
        {
          get: (url, options, callback) => {
            logger.debug("lx.request.get called with:", url);
            if (typeof callback === "function") {
              callback(null, {
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            } else {
              logger.debug("lx.request.get: callback不是函数，返回Promise");
              return Promise.resolve({
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            }
          },
          post: (url, options, callback) => {
            logger.debug("lx.request.post called with:", url);
            if (typeof callback === "function") {
              callback(null, {
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            } else {
              logger.debug("lx.request.post: callback不是函数，返回Promise");
              return Promise.resolve({
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            }
          },
          request: (options, callback) => {
            logger.debug(
              "lx.request.request called with:",
              options.url || options,
            );
            if (typeof callback === "function") {
              callback(null, {
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            } else {
              logger.debug("lx.request.request: callback不是函数，返回Promise");
              return Promise.resolve({
                statusCode: 200,
                data: { info: { url: "", data: "" } },
              });
            }
          },
        },
      ),
      // 添加其他可能需要的属性
      EVENT_NAMES: {
        qualitychange: "qualitychange",
      },
      on: (event, callback) => {
        logger.debug("lx.on called with event:", event);
      },
      send: (event, data) => {
        logger.debug("lx.send called with event:", event);
      },
      env: "development",
    };

    // 创建沙箱环境
    const sandbox = {};

    // 首先设置全局指向
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    // 添加我们需要的特定对象
    sandbox.lx = lxObj;
    sandbox.globalThis.lx = lxObj; // 确保globalThis上也有lx对象
    sandbox.module = { exports: {} };
    sandbox.exports = sandbox.module.exports;
    sandbox.export = {};
    sandbox.document = {};
    sandbox.navigator = {};
    sandbox.location = {};

    // 添加更多可能需要的网络相关对象
    sandbox.Headers =
      global.Headers ||
      function () {
        return {};
      };
    sandbox.Request =
      global.Request ||
      function () {
        return {};
      };
    sandbox.Response =
      global.Response ||
      function () {
        return {};
      };

    // 添加常用工具函数
    sandbox.setTimeout = setTimeout;
    sandbox.setInterval = setInterval;
    sandbox.clearTimeout = clearTimeout;
    sandbox.clearInterval = clearInterval;

    // 显式添加所有必需的内置对象和它们的方法
    // 这样可以确保它们在沙箱中始终可用，无论代码如何尝试访问它们
    sandbox.Array = Array;
    sandbox.Object = Object;
    sandbox.String = String;
    sandbox.Number = Number;
    sandbox.Boolean = Boolean;
    sandbox.Function = Function;
    sandbox.Date = Date;
    sandbox.RegExp = RegExp;
    sandbox.Math = Math;
    sandbox.JSON = JSON;
    sandbox.Error = Error;
    sandbox.TypeError = TypeError;
    sandbox.RangeError = RangeError;
    sandbox.ReferenceError = ReferenceError;
    sandbox.SyntaxError = SyntaxError;
    sandbox.EvalError = EvalError;
    sandbox.URIError = URIError;
    sandbox.Map = Map;
    sandbox.Set = Set;
    sandbox.WeakMap = WeakMap;
    sandbox.WeakSet = WeakSet;
    sandbox.Symbol = Symbol;
    sandbox.Promise = Promise;
    sandbox.Reflect = Reflect;
    sandbox.Proxy = Proxy;

    // 确保所有Array方法都可用
    sandbox.Array.from = Array.from;
    sandbox.Array.isArray = Array.isArray;
    sandbox.Array.of = Array.of;
    sandbox.Array.prototype.forEach = Array.prototype.forEach;
    sandbox.Array.prototype.map = Array.prototype.map;
    sandbox.Array.prototype.filter = Array.prototype.filter;
    sandbox.Array.prototype.reduce = Array.prototype.reduce;
    sandbox.Array.prototype.reduceRight = Array.prototype.reduceRight;
    sandbox.Array.prototype.find = Array.prototype.find;
    sandbox.Array.prototype.findIndex = Array.prototype.findIndex;
    sandbox.Array.prototype.includes = Array.prototype.includes;
    sandbox.Array.prototype.join = Array.prototype.join;
    sandbox.Array.prototype.concat = Array.prototype.concat;
    sandbox.Array.prototype.slice = Array.prototype.slice;
    sandbox.Array.prototype.splice = Array.prototype.splice;
    sandbox.Array.prototype.sort = Array.prototype.sort;
    sandbox.Array.prototype.reverse = Array.prototype.reverse;

    // 确保所有Object方法都可用
    sandbox.Object.assign = Object.assign;
    sandbox.Object.create = Object.create;
    sandbox.Object.keys = Object.keys;
    sandbox.Object.values = Object.values;
    sandbox.Object.entries = Object.entries;
    sandbox.Object.defineProperty = Object.defineProperty;
    sandbox.Object.defineProperties = Object.defineProperties;
    sandbox.Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    sandbox.Object.getOwnPropertyNames = Object.getOwnPropertyNames;
    sandbox.Object.getOwnPropertySymbols = Object.getOwnPropertySymbols;
    sandbox.Object.hasOwnProperty = Object.hasOwnProperty;
    sandbox.Object.is = Object.is;
    sandbox.Object.isExtensible = Object.isExtensible;
    sandbox.Object.isFrozen = Object.isFrozen;
    sandbox.Object.isSealed = Object.isSealed;
    sandbox.Object.preventExtensions = Object.preventExtensions;
    sandbox.Object.freeze = Object.freeze;
    sandbox.Object.seal = Object.seal;

    // 确保所有String方法都可用
    sandbox.String.fromCharCode = String.fromCharCode;
    sandbox.String.fromCodePoint = String.fromCodePoint;
    sandbox.String.prototype.includes = String.prototype.includes;
    sandbox.String.prototype.startsWith = String.prototype.startsWith;
    sandbox.String.prototype.endsWith = String.prototype.endsWith;
    sandbox.String.prototype.indexOf = String.prototype.indexOf;
    sandbox.String.prototype.lastIndexOf = String.prototype.lastIndexOf;
    sandbox.String.prototype.match = String.prototype.match;
    sandbox.String.prototype.replace = String.prototype.replace;
    sandbox.String.prototype.split = String.prototype.split;
    sandbox.String.prototype.substring = String.prototype.substring;
    sandbox.String.prototype.slice = String.prototype.slice;
    sandbox.String.prototype.toLowerCase = String.prototype.toLowerCase;
    sandbox.String.prototype.toUpperCase = String.prototype.toUpperCase;
    sandbox.String.prototype.trim = String.prototype.trim;
    sandbox.String.prototype.trimStart = String.prototype.trimStart;
    sandbox.String.prototype.trimEnd = String.prototype.trimEnd;

    // 全局函数
    sandbox.parseInt = parseInt;
    sandbox.parseFloat = parseFloat;
    sandbox.isNaN = isNaN;
    sandbox.isFinite = isFinite;
    sandbox.decodeURI = decodeURI;
    sandbox.decodeURIComponent = decodeURIComponent;
    sandbox.encodeURI = encodeURI;
    sandbox.encodeURIComponent = encodeURIComponent;
    sandbox.atob = atob;
    sandbox.btoa = btoa;
    sandbox.console = console;

    // 全局对象
    sandbox.Infinity = Infinity;
    sandbox.NaN = NaN;
    sandbox.undefined = undefined;
    sandbox.null = null;

    // 添加一个全局的from方法作为最后防线，以防代码尝试直接使用全局from而不是Array.from
    sandbox.from = Array.from;

    // 现在创建上下文，确保所有属性都已添加
    vm.createContext(sandbox);

    // 尝试执行JS代码，提取歌曲数据
    let foundSongs = null;

    try {
      // 使用Script类和之前创建好的上下文
      const script = new vm.Script(content);

      logger.info("开始执行脚本，设置60秒超时...");

      // 创建一个Promise来等待事件触发或直接获取歌曲数据
      const songPromise = new Promise((resolve, reject) => {
        // 在沙箱中添加事件监听和结果存储
        let eventReceived = false;
        let timeoutId = null;

        // 覆盖lx.send方法以捕获发送的歌曲数据
        const originalSend = sandbox.lx.send;
        sandbox.lx.send = function (eventName, data) {
          logger.debug("捕获到lx.send调用:", eventName, data);

          // 如果是发送歌曲数据的事件
          if (eventName && typeof eventName === "string") {
            // 检查是否包含歌曲列表
            if (data && typeof data === "object" && data.sources) {
              logger.info("从lx.send捕获到歌曲数据");
              eventReceived = true;
              resolve(data.sources);
              if (timeoutId) clearTimeout(timeoutId);
            } else if (
              data &&
              typeof data === "object" &&
              Object.values(data).some((v) => Array.isArray(v))
            ) {
              logger.info("从lx.send捕获到歌曲数据（格式2）");
              eventReceived = true;
              resolve(Object.values(data).find((v) => Array.isArray(v)));
              if (timeoutId) clearTimeout(timeoutId);
            } else if (data && typeof data === "object") {
              logger.info("从lx.send捕获到对象数据:", Object.keys(data));
              // 尝试查找任何可能包含歌曲的属性
              for (const key in data) {
                if (
                  Array.isArray(data[key]) &&
                  data[key].length > 0 &&
                  typeof data[key][0] === "object"
                ) {
                  logger.info(`从${key}属性找到歌曲数组`);
                  eventReceived = true;
                  resolve(data[key]);
                  if (timeoutId) clearTimeout(timeoutId);
                  return;
                }
              }
            }
          }

          // 调用原始的send方法
          if (originalSend) originalSend.apply(this, arguments);
        };

        // 设置超时
        timeoutId = setTimeout(() => {
          if (!eventReceived) {
            logger.info("脚本执行超时，未捕获到事件，尝试直接查找歌曲数据");
            resolve(null); // 让后续代码尝试直接查找
          }
        }, 10000);

        // 直接执行脚本
        const startTime = Date.now();
        script.runInContext(sandbox, { timeout: 60000 });
        const executionTime = Date.now() - startTime;

        logger.info(`JS脚本执行完成，耗时: ${executionTime}ms`);

        // 尝试触发搜索事件，以让插件返回歌曲数据
        logger.info("尝试触发搜索事件...");
        if (sandbox.lx && sandbox.lx.event && sandbox.lx.event.emit) {
          sandbox.lx.event.emit("musicSource.search", {
            keyword: "test",
            page: 1,
          });
        } else {
          // 如果没有event.emit方法，尝试直接调用可能的search方法
          logger.info("尝试查找并调用search方法...");
          // 检查lx对象上的方法
          for (const key in sandbox.lx) {
            if (
              typeof sandbox.lx[key] === "function" &&
              (key.includes("search") || key.includes("get"))
            ) {
              logger.info(`调用方法: ${key}`);
              try {
                sandbox.lx[key]({
                  keyword: "test",
                  page: 1,
                });
              } catch (e) {
                logger.error(`调用方法${key}失败: ${e.message}`);
              }
            }
          }
        }
      });

      // 等待事件或直接获取结果
      foundSongs = await songPromise;

      // 如果没有从事件中获取到歌曲数据，尝试直接查找
      if (!foundSongs) {
        logger.info("尝试直接查找歌曲数据...");

        // 查找可能的歌曲变量名
        const possibleVariables = ["songs", "music", "tracks", "playlist"];
        for (const varName of possibleVariables) {
          if (Array.isArray(sandbox[varName])) {
            foundSongs = sandbox[varName];
            logger.info(`从全局变量${varName}找到歌曲数据`);
            break;
          }
        }

        // 检查是否有导出的歌曲数据
        if (
          !foundSongs &&
          sandbox.module &&
          Array.isArray(sandbox.module.exports)
        ) {
          foundSongs = sandbox.module.exports;
          logger.info("从module.exports找到歌曲数据");
        }

        if (!foundSongs && sandbox.export && Array.isArray(sandbox.export)) {
          foundSongs = sandbox.export;
          logger.info("从export找到歌曲数据");
        }
      }

      logger.info("沙箱内容概览:");
      logger.info(`  - 全局变量数量: ${Object.keys(sandbox).length}`);
      logger.info(`  - module.exports: ${typeof sandbox.module.exports}`);
      logger.info(`  - export: ${typeof sandbox.export}`);

      // 尝试找出所有可能的导出数据
      const allKeys = Object.keys(sandbox);
      const arrayKeys = allKeys.filter((key) => Array.isArray(sandbox[key]));
      const objectKeys = allKeys.filter(
        (key) =>
          typeof sandbox[key] === "object" &&
          sandbox[key] !== null &&
          !Array.isArray(sandbox[key]),
      );

      logger.info(`  - 数组类型变量: ${arrayKeys.join(", ") || "无"}`);
      logger.info(
        `  - 对象类型变量: ${objectKeys.slice(0, 10).join(", ")}${objectKeys.length > 10 ? "..." : ""}`,
      );
    } catch (e) {
      logger.error("JS脚本执行错误:", e);
      console.error("Error executing script:", e);
      return res.status(400).json({
        error: "执行错误",
        message: `执行音乐源代码时发生错误: ${e.message}`,
      });
    }

    if (!Array.isArray(foundSongs)) {
      return res.status(400).json({
        error: "格式错误",
        message: "JS文件必须导出歌曲数组",
      });
    }

    songs = foundSongs;

    // 验证歌曲数据结构
    const validSongs = songs.filter(
      (song) => song.title && song.file_url && (song.artist || "未知艺术家"),
    );

    if (validSongs.length === 0) {
      return res.status(400).json({
        error: "数据无效",
        message: "音乐源文件中没有有效的歌曲数据",
      });
    }

    // 返回结果
    return res.status(200).json({
      success: true,
      message: `成功导入 ${validSongs.length} 首歌曲`,
      songs: validSongs,
    });
  } catch (error) {
    logger.error("音乐源导入失败:", error);
    return res.status(500).json({
      error: "导入失败",
      message: `处理音乐源文件时发生错误: ${error.message}`,
    });
  }
});

// 音乐源导入API端点
app.post("/api/music-source/import", async (req, res) => {
  try {
    let content, format, filename;

    // 检查是文件上传还是URL导入
    if (req.body.url) {
      // URL导入
      const url = req.body.url;

      // 验证URL格式
      try {
        new URL(url);
      } catch (error) {
        return res.status(400).json({
          error: "参数错误",
          message: "请提供有效的URL",
        });
      }

      // 从URL获取音乐源内容
      const fetch = require("node-fetch");

      // 重试机制配置
      const maxRetries = 3;
      const retryDelay = 2000; // 2秒

      // 常用代理列表（作为回退选项）
      const proxyList = [
        // 可以根据需要添加代理服务器
        // 'http://127.0.0.1:7890',
        // 'https://ghproxy.net/'
      ];

      let currentRetry = 0;
      let proxyIndex = -1;
      let success = false;
      let lastError = null;

      while (currentRetry < maxRetries && !success) {
        currentRetry++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

        try {
          // 构建请求选项
          const fetchOptions = {
            signal: controller.signal,
            timeout: 30000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
          };

          // 尝试使用代理（如果有的话）
          let fetchUrl = url;
          if (proxyIndex >= 0 && proxyList.length > 0) {
            const proxy = proxyList[proxyIndex % proxyList.length];
            if (proxy.startsWith("https://ghproxy.net/")) {
              // ghproxy.net 特定处理
              fetchUrl = proxy + url;
            } else {
              // 常规代理
              fetchOptions.agent = new (require("https-proxy-agent"))(proxy);
            }
          }

          logger.info(
            `尝试获取音乐源 (${currentRetry}/${maxRetries})${proxyIndex >= 0 ? ` 使用代理: ${proxyList[proxyIndex % proxyList.length]}` : ""}: ${fetchUrl}`,
          );

          const response = await fetch(fetchUrl, fetchOptions);

          if (!response.ok) {
            throw new Error(
              `HTTP错误: ${response.status} ${response.statusText}`,
            );
          }

          content = await response.text();
          success = true;
          logger.info(`成功获取音乐源内容，大小: ${content.length} 字符`);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          lastError = fetchError;

          // 如果是网络错误，尝试使用代理或重试
          if (
            fetchError.code === "ECONNRESET" ||
            fetchError.code === "ETIMEDOUT"
          ) {
            // 第一次失败后尝试使用代理
            if (proxyIndex === -1 && proxyList.length > 0) {
              proxyIndex = 0;
              logger.info("网络错误，尝试使用代理重新请求...");
              currentRetry--; // 不计入重试次数
            } else if (proxyIndex < proxyList.length - 1) {
              // 尝试下一个代理
              proxyIndex++;
              logger.info(
                `当前代理失败，尝试下一个代理 (${proxyIndex + 1}/${proxyList.length})...`,
              );
              currentRetry--; // 不计入重试次数
            } else if (currentRetry < maxRetries) {
              // 没有更多代理，直接重试
              logger.info(
                `请求失败，${retryDelay / 1000}秒后重试 (${currentRetry}/${maxRetries})...`,
              );
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
          } else {
            // 非网络错误，不重试
            break;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!success) {
        // 详细的错误处理
        let errorMsg = "获取内容失败";
        if (lastError.name === "AbortError") {
          errorMsg = "请求超时，请检查网络连接或URL是否可用";
        } else if (lastError.code === "ECONNRESET") {
          errorMsg = "连接重置，请检查网络或尝试使用代理";
        } else if (lastError.code === "ECONNREFUSED") {
          errorMsg = "连接被拒绝，请检查URL是否正确";
        } else if (lastError.code === "ENOTFOUND") {
          errorMsg = "域名未找到，请检查URL是否正确";
        } else if (lastError.message?.includes("HTTP错误")) {
          errorMsg = "服务器返回错误";
        }

        return res.status(500).json({
          error: "网络错误",
          message: `${errorMsg}: ${lastError.message}`,
        });
      }

      // 确定文件格式
      const urlPath = url.split("/").pop().toLowerCase();
      if (urlPath.endsWith(".js")) {
        format = "js";
        filename = urlPath;
      } else if (urlPath.endsWith(".json")) {
        format = "json";
        filename = urlPath;
      } else {
        // 尝试解析内容来确定格式
        try {
          JSON.parse(content);
          format = "json";
          filename = "music-source.json";
        } catch (jsonError) {
          // 假设是JS格式
          format = "js";
          filename = "music-source.js";
        }
      }
    } else {
      // 文件上传
      const {
        filename: reqFilename,
        content: reqContent,
        format: reqFormat,
      } = req.body;

      if (!reqFilename || !reqContent || !reqFormat) {
        return res.status(400).json({
          error: "参数缺失",
          message: "请提供文件名、文件内容和格式",
        });
      }

      filename = reqFilename;
      content = reqContent;
      format = reqFormat;
    }

    let songs = [];

    // 解析音乐源文件内容
    try {
      if (format === "json") {
        // JSON格式：直接解析数组
        const data = JSON.parse(content);
        if (!Array.isArray(data)) {
          return res.status(400).json({
            error: "格式错误",
            message: "JSON文件必须包含歌曲数组",
          });
        }
        songs = data;
      } else if (format === "js") {
        // JS格式：使用子进程隔离执行方案
        logger.info("开始使用子进程隔离执行JS音乐源代码...");
        logger.info("脚本内容长度:", content.length, "字符");

        // 记录执行开始时间
        const startTime = Date.now();

        // 使用子进程执行脚本
        const result = await executeMusicSourceScript(content, filename, 60000);

        // 记录执行结束时间
        const endTime = Date.now();
        logger.info("JS音乐源代码执行成功，耗时:", endTime - startTime, "毫秒");

        // 解析执行结果 - 添加更详细的调试日志
        logger.info("子进程执行结果摘要:", {
          success: result.success,
          songsCount: result.songs ? result.songs.length : 0,
          executionTime: result.executionTime,
          executionSteps: result.executionSteps,
        });

        // 记录调试信息（如果有）
        if (result.debug) {
          logger.info(
            "子进程调试信息 - 沙箱变量数量:",
            result.debug.allVariables.length,
          );
          logger.info(
            "子进程调试信息 - 所有沙箱变量:",
            result.debug.allVariables,
          );

          if (result.debug.moduleExports) {
            logger.info(
              "子进程调试信息 - module.exports 类型:",
              typeof result.debug.moduleExports,
            );
            if (typeof result.debug.moduleExports === "object") {
              logger.info(
                "子进程调试信息 - module.exports 键:",
                Object.keys(result.debug.moduleExports),
              );
            }
          }

          if (result.debug.lxStructure) {
            logger.info(
              "子进程调试信息 - lx 结构:",
              JSON.stringify(result.debug.lxStructure, null, 2),
            );
          }
        }

        // 获取歌曲数据
        songs = result.songs || [];

        // 检查模块导出的结构
        if (result.module && result.module.exports) {
          const exports = result.module.exports;
          logger.info("module.exports 详细分析:", {
            type: typeof exports,
            isArray: Array.isArray(exports),
            keys: typeof exports === "object" ? Object.keys(exports) : [],
            has0: 0 in exports,
            has1: 1 in exports,
            length: Array.isArray(exports)
              ? exports.length
              : typeof exports === "object"
                ? Object.keys(exports).length
                : 0,
          });
        }

        // 检查 lx 对象的详细结构
        if (result.lx && typeof result.lx === "object") {
          logger.info("lx 对象详细分析:", {
            keys: Object.keys(result.lx),
            apiType: typeof result.lx.api,
            appType: typeof result.lx.app,
            utilsType: typeof result.lx.utils,
            dataType: typeof result.lx.data,
          });

          // 检查 lx.api
          if (result.lx.api && typeof result.lx.api === "object") {
            logger.info("lx.api 方法:", Object.keys(result.lx.api));
          }

          // 检查 lx.data
          if (
            result.lx &&
            result.lx.data &&
            typeof result.lx.data === "object"
          ) {
            logger.info(
              "lx.data 内容:",
              JSON.stringify(result.lx.data).substring(0, 200) + "...",
            );
            // 如果lx.data中有歌曲数据，也可以考虑使用
            if (!songs.length && Array.isArray(result.lx.data)) {
              songs = result.lx.data;
              logger.info("从lx.data中提取到歌曲数据");
            }
          }
        }

        // 验证歌曲数组
        if (!Array.isArray(songs) || songs.length === 0) {
          logger.error("未找到有效的歌曲数组");
          return res.status(400).json({
            error: "格式错误",
            message: "JS文件必须导出有效的歌曲数组",
          });
        }

        logger.info(`成功提取到 ${songs.length} 首歌曲`);
      } else {
        return res.status(400).json({
          error: "格式不支持",
          message: "只支持JS和JSON格式的音乐源文件",
        });
      }
    } catch (error) {
      logger.error("导入音乐源时出错:", error);
      return res.status(500).json({
        error: "执行错误",
        message: "执行音乐源脚本时发生错误: " + error.message,
      });
    }

    // 验证歌曲数据结构
    const validSongs = songs.filter(
      (song) => song.title && song.file_url && (song.artist || "未知艺术家"),
    );

    if (validSongs.length === 0) {
      return res.status(400).json({
        error: "数据无效",
        message: "音乐源文件中没有有效的歌曲数据",
      });
    }

    // 保存到数据库
    let songsAdded = 0;

    for (const song of validSongs) {
      // 生成唯一ID
      const id = crypto.randomBytes(16).toString("hex");

      // 准备歌曲数据
      const songData = {
        id,
        filename: path.basename(song.file_url),
        originalFilename: song.title + path.extname(song.file_url),
        title: song.title,
        artist: song.artist || "未知艺术家",
        album: song.album || "未知专辑",
        year: song.year || null,
        genre: song.genre || null,
        duration: song.duration || 0,
        format: path.extname(song.file_url).toLowerCase().slice(1),
        filePath: "", // 网络音乐源不需要本地路径
        fileUrl: song.file_url,
        coverUrl: song.cover_url || null,
        lyricFile: null,
        uploadDate: new Date().toISOString(),
        playCount: 0,
        fileHash: null,
      };

      // 插入数据库
      try {
        dbManager.db
          .prepare(
            `
                    INSERT OR IGNORE INTO songs (
                        id, filename, original_filename, title, artist, album, year, genre,
                        duration, format, file_path, file_url, cover_url, lyric_file,
                        upload_date, play_count, file_hash
                    ) VALUES (
                        @id, @filename, @originalFilename, @title, @artist, @album, @year, @genre,
                        @duration, @format, @filePath, @fileUrl, @coverUrl, @lyricFile,
                        @uploadDate, @playCount, @fileHash
                    )
                `,
          )
          .run(songData);

        songsAdded++;
      } catch (dbError) {
        logger.warn(`保存歌曲失败: ${song.title} - ${dbError.message}`);
        // 继续处理其他歌曲
      }
    }

    res.json({
      success: true,
      message: `成功导入 ${songsAdded} 首歌曲`,
      songsAdded,
      totalSongs: validSongs.length,
    });
  } catch (error) {
    logger.error("音乐源导入失败:", error);
    res.status(500).json({
      error: "导入失败",
      message: "处理音乐源文件时发生错误",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ======================== 前端路由（关键修复） ========================
// API 404 处理器
app.use("/api/*", (req, res) => {
  res.status(404).json({
    error: "接口不存在",
    message: `请求的 API 接口 ${req.originalUrl} 不存在`,
  });
});

// 前端路由 - 所有非API请求返回index.html
// app.get('*', (req, res) => {

//     // 排除 API 路由
//     if (req.path.startsWith('/api/')) {
//         return res.status(404).json({
//             error: 'API 接口不存在',
//             message: `请求的接口 ${req.originalUrl} 不存在`
//         });
//     }

//     // 检查是否为静态文件
//     const ext = path.extname(req.path).toLowerCase();
//     const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.map'];

//     if (staticExtensions.includes(ext)) {
//         const filePath = path.join(CONFIG.FRONTEND_DIR, req.path);
//         return res.sendFile(filePath, (err) => {
//             if (err) {
//                 console.log('静态文件未找到:', req.path);
//                 res.sendFile(path.join(CONFIG.FRONTEND_DIR, 'index.html'));
//             }
//         });
//     }

//     // 否则返回 index.html（前端路由处理）
//     res.sendFile(path.join(CONFIG.FRONTEND_DIR, 'index.html'), err => {
//         if (err) {
//             console.error('发送 index.html 失败:', err);
//             res.status(500).send('服务器错误');
//         }
//     });
// });

// 前端路由 - 智能处理静态文件与前端路由
app.get("*", (req, res) => {
  // 1. 检查是否为静态资源文件
  const ext = path.extname(req.path).toLowerCase();
  const staticExtensions = [
    ".js",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".ogg",
    ".m4a",
    ".webm",
    ".map",
    ".json",
    ".txt",
    ".xml",
  ];

  // 2. 如果是静态文件扩展名，尝试从前端目录或静态目录提供
  if (staticExtensions.includes(ext)) {
    // 首先尝试从前端目录提供
    const frontendPath = path.join(CONFIG.FRONTEND_DIR, req.path);

    // 使用同步检查，避免异步问题
    try {
      if (
        fsSync.existsSync(frontendPath) &&
        fsSync.statSync(frontendPath).isFile()
      ) {
        return res.sendFile(frontendPath, {
          maxAge: config.NODE_ENV === "production" ? "1d" : 0,
          headers: {
            "Cache-Control":
              config.NODE_ENV === "production"
                ? "public, max-age=86400"
                : "no-cache",
          },
        });
      }
    } catch (error) {
      // 文件不存在或访问错误，继续尝试其他位置
    }

    // 尝试从公共静态目录提供
    const publicPath = path.join(__dirname, "public", req.path);
    try {
      if (
        fsSync.existsSync(publicPath) &&
        fsSync.statSync(publicPath).isFile()
      ) {
        return res.sendFile(publicPath, {
          maxAge: config.NODE_ENV === "production" ? "1d" : 0,
        });
      }
    } catch (error) {
      // 文件不存在，继续处理
    }

    // 尝试从音乐目录提供（针对音乐文件流）
    if (
      [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".webm"].includes(ext)
    ) {
      const musicPath = path.join(CONFIG.MUSIC_DIR, path.basename(req.path));
      try {
        if (
          fsSync.existsSync(musicPath) &&
          fsSync.statSync(musicPath).isFile()
        ) {
          return res.sendFile(musicPath);
        }
      } catch (error) {
        // 音乐文件不存在
      }
    }

    // 尝试从封面目录提供
    if ([".png", ".jpg", ".jpeg", ".gif"].includes(ext)) {
      const coverPath = path.join(CONFIG.COVERS_DIR, path.basename(req.path));
      try {
        if (
          fsSync.existsSync(coverPath) &&
          fsSync.statSync(coverPath).isFile()
        ) {
          return res.sendFile(coverPath);
        }
      } catch (error) {
        // 封面文件不存在
      }
    }

    // 如果静态文件不存在，返回404而不是index.html
    return res.status(404).json({
      error: "静态资源不存在",
      path: req.path,
      message: "请求的静态文件不存在",
    });
  }

  // 3. 排除API路由（已经由前面的中间件处理）
  if (req.path.startsWith("/api/")) {
    // 如果前面的API 404处理器没有捕获，这里再次处理
    return res.status(404).json({
      error: "API接口不存在",
      path: req.path,
    });
  }

  // 4. 对于所有其他请求（前端路由），返回index.html
  const indexPath = path.join(CONFIG.FRONTEND_DIR, "index.html");

  // 检查index.html是否存在
  try {
    if (!fsSync.existsSync(indexPath)) {
      // 如果前端目录不存在或index.html不存在，返回友好的错误页面
      return res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>前端文件未找到</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        h1 { color: #e74c3c; }
                        .container { max-width: 600px; margin: 0 auto; }
                        .code { background: #f4f4f4; padding: 10px; border-radius: 5px; font-family: monospace; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>前端文件未找到</h1>
                        <p>服务器无法找到前端应用文件。</p>
                        <p>请确保前端文件已正确构建并放置在以下目录：</p>
                        <div class="code">${CONFIG.FRONTEND_DIR}</div>
                        <p>或者检查服务器配置中的 <strong>FRONTEND_DIR</strong> 路径设置。</p>
                        <p>当前路径: <code>${req.path}</code></p>
                    </div>
                </body>
                </html>
            `);
    }
  } catch (error) {
    logger.error("检查index.html失败:", error);
    return res.status(500).send("服务器配置错误：无法访问前端文件");
  }

  // 5. 发送index.html（Vue/React等前端框架的路由将处理后续路由）
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error("发送index.html失败:", err);

      // 如果发送失败，返回详细的错误信息
      if (err.code === "ENOENT") {
        res.status(500).send(`
                    <!DOCTYPE html>
                    <html>
                    <head><title>服务器错误</title></head>
                    <body>
                        <h1>服务器配置错误</h1>
                        <p>无法找到前端应用的入口文件。</p>
                        <p>请检查服务器配置并确保前端应用已正确构建。</p>
                        <p>错误详情: ${err.message}</p>
                    </body>
                    </html>
                `);
      } else {
        res.status(500).send("服务器内部错误");
      }
    }
  });
});

// ======================== 错误处理 ========================
// 全局错误处理
app.use((err, req, res, next) => {
  logger.error("服务器错误:", err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "文件太大，最大支持100MB" });
    }
    return res.status(400).json({ error: err.message });
  }

  const errorResponse = {
    error: err.message || "服务器内部错误",
    type: err.name,
  };

  if (config.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
  }

  res.status(500).json(errorResponse);
});

// ======================== 辅助函数 ========================
const utils = {
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },

  // 内存缓存配置
  _memoryCache: {
    data: new Map(),
    maxSize: 1000, // 最大缓存1000首歌的歌词
    ttl: 60 * 60 * 1000, // 缓存有效期1小时
  },

  // 持久化缓存配置
  _persistentCache: {
    dir: path.join(__dirname, "cache", "lyrics"),
    ttl: 7 * 24 * 60 * 60 * 1000, // 持久化缓存有效期7天
  },

  // 获取缓存键
  _getCacheKey(title, artist) {
    return `${title.toLowerCase().trim()}-${artist.toLowerCase().trim()}`;
  },

  // 从内存缓存获取歌词
  _getFromCache(title, artist) {
    const key = this._getCacheKey(title, artist);
    const cached = this._memoryCache.data.get(key);

    if (cached) {
      const now = Date.now();
      if (now - cached.timestamp < this._memoryCache.ttl) {
        logger.debug(`从内存缓存获取歌词: "${title}" - "${artist}"`);
        return cached.lyrics;
      }
      // 缓存过期，移除
      this._memoryCache.data.delete(key);
    }
    return null;
  },

  // 初始化持久化缓存目录
  _initPersistentCache() {
    try {
      if (!fsSync.existsSync(this._persistentCache.dir)) {
        fsSync.mkdirSync(this._persistentCache.dir, { recursive: true });
        logger.debug(`持久化缓存目录已创建: ${this._persistentCache.dir}`);
      }
    } catch (error) {
      logger.error("创建持久化缓存目录失败:", error);
    }
  },

  // 从持久化缓存获取歌词
  async _getFromPersistentCache(title, artist) {
    try {
      const key = this._getCacheKey(title, artist);
      const cacheFile = path.join(this._persistentCache.dir, `${key}.json`);

      if (!fsSync.existsSync(cacheFile)) {
        return null;
      }

      const cacheData = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      const now = Date.now();

      if (now - cacheData.timestamp < this._persistentCache.ttl) {
        logger.debug(`从持久化缓存获取歌词: "${title}" - "${artist}"`);
        return cacheData.lyrics;
      }

      // 缓存过期，删除
      fsSync.unlinkSync(cacheFile);
      return null;
    } catch (error) {
      logger.error("从持久化缓存获取歌词失败:", error);
      return null;
    }
  },

  // 保存歌词到持久化缓存
  async _saveToPersistentCache(title, artist, lyrics) {
    try {
      if (!lyrics) return;

      // 确保缓存目录存在
      this._initPersistentCache();

      const key = this._getCacheKey(title, artist);
      const cacheFile = path.join(this._persistentCache.dir, `${key}.json`);

      const cacheData = {
        lyrics,
        timestamp: Date.now(),
        title,
        artist,
      };

      await fs.writeFile(cacheFile, JSON.stringify(cacheData), "utf8");
      logger.debug(`保存歌词到持久化缓存: "${title}" - "${artist}"`);
    } catch (error) {
      logger.error("保存歌词到持久化缓存失败:", error);
    }
  },

  // 保存歌词到内存缓存
  _saveToCache(title, artist, lyrics) {
    if (!lyrics) return;

    const key = this._getCacheKey(title, artist);

    // 如果缓存已满，移除最旧的10%的缓存
    if (this._memoryCache.data.size >= this._memoryCache.maxSize) {
      const entries = Array.from(this._memoryCache.data.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const removeCount = Math.ceil(this._memoryCache.maxSize * 0.1);

      for (let i = 0; i < removeCount; i++) {
        this._memoryCache.data.delete(entries[i][0]);
      }
    }

    this._memoryCache.data.set(key, {
      lyrics,
      timestamp: Date.now(),
    });
    logger.debug(`保存歌词到内存缓存: "${title}" - "${artist}"`);
  },

  // 完整的歌词获取方法（多源并行 + 二级缓存）
  async fetchLyricsFromWeb(title, artist) {
    try {
      if (!title || !artist) {
        logger.warn(
          `跳过歌词搜索：歌名或歌手为空 - title: "${title}", artist: "${artist}"`,
        );
        return null;
      }

      // 1. 首先从内存缓存获取
      let lyrics = this._getFromCache(title, artist);
      if (lyrics) {
        logger.debug(`从内存缓存获取歌词: "${title}" - "${artist}"`);
        return lyrics;
      }

      // 2. 从持久化缓存获取
      lyrics = await this._getFromPersistentCache(title, artist);
      if (lyrics) {
        logger.debug(`从持久化缓存获取歌词: "${title}" - "${artist}"`);
        // 同时保存到内存缓存，提高下次访问速度
        this._saveToCache(title, artist, lyrics);
        return lyrics;
      }

      logger.debug(`开始搜索歌词: "${title}" - "${artist}"`);

      // 3. 尝试多个API源，并行请求
      const sources = [
        { name: "网易云音乐", func: this._fetchFromNetease.bind(this) },
        { name: "QQ音乐", func: this._fetchFromQQMusic.bind(this) },
        { name: "Lyrics.ovh", func: this._fetchFromLyricsOvh.bind(this) },
        { name: "酷狗音乐", func: this._fetchFromKugou.bind(this) },
        { name: "百度音乐", func: this._fetchFromBaidu.bind(this) },
      ];

      // 并行请求所有API源
      const promises = sources.map(async (source) => {
        try {
          logger.debug(`尝试从 ${source.name} 获取歌词...`);
          const result = await source.func(title, artist);
          if (result && this._validateLyrics(result)) {
            logger.debug(`${source.name} 获取成功: "${title}" - "${artist}"`);
            return {
              success: true,
              source: source.name,
              lyrics: result,
            };
          }
          logger.debug(`${source.name} 获取失败: 无效歌词格式`);
          return {
            success: false,
            source: source.name,
            error: "无效歌词",
          };
        } catch (error) {
          logger.warn(`${source.name} 获取失败: ${error.message}`);
          return {
            success: false,
            source: source.name,
            error: error.message,
          };
        }
      });

      // 等待所有请求完成
      const results = await Promise.allSettled(promises);

      // 筛选成功的结果
      const successfulResults = results
        .filter(
          (result) => result.status === "fulfilled" && result.value.success,
        )
        .map((result) => result.value);

      if (successfulResults.length > 0) {
        // 按优先级选择结果（保持原有顺序）
        for (const source of sources) {
          const found = successfulResults.find(
            (result) => result.source === source.name,
          );
          if (found) {
            logger.info(
              `从 ${found.source} 成功获取歌词: "${title}" - "${artist}"`,
            );
            const cleanedLyrics = this._cleanLyrics(found.lyrics);

            // 同时保存到内存缓存和持久化缓存
            this._saveToCache(title, artist, cleanedLyrics);
            await this._saveToPersistentCache(title, artist, cleanedLyrics);

            return cleanedLyrics;
          }
        }
      }

      // 收集所有失败信息
      const failedResults = results
        .filter(
          (result) => result.status === "fulfilled" && !result.value.success,
        )
        .map((result) => `${result.value.source}: ${result.value.error}`);

      logger.warn(`所有歌词源都失败: ${failedResults.join(", ")}`);

      // 尝试用简化的歌名重新搜索
      const simplifiedTitle = this._simplifyTitle(title);
      if (simplifiedTitle !== title) {
        logger.debug(
          `尝试简化歌名重新搜索: "${simplifiedTitle}" - "${artist}"`,
        );
        return await this.fetchLyricsFromWeb(simplifiedTitle, artist);
      }

      logger.debug(`歌词搜索完全失败: "${title}" - "${artist}"`);
      return null;
    } catch (error) {
      logger.error("获取歌词过程中出错:", error);
      return null;
    }
  },

  // 带重试和指数退避的通用请求函数
  async _requestWithRetry(requestFn, maxRetries = 3, initialDelay = 500) {
    let lastError;

    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // 如果是最后一次重试，直接抛出错误
        if (retryCount === maxRetries) {
          throw error;
        }

        // 计算指数退避延迟
        const delay =
          initialDelay * Math.pow(2, retryCount) + Math.random() * 100;
        logger.debug(
          `请求失败，${retryCount + 1}/${maxRetries} 秒后重试... (延迟: ${Math.round(delay)}ms)`,
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  },

  // 从网易云音乐获取歌词
  async _fetchFromNetease(title, artist) {
    try {
      // 1. 搜索歌曲
      const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(`${title} ${artist}`)}&type=1&offset=0&limit=10`;
      const searchResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: searchUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://music.163.com/",
            Accept: "application/json, text/plain, */*",
          },
          timeout: 8000,
        });
      });

      if (
        !searchResponse.data ||
        !searchResponse.data.result ||
        !searchResponse.data.result.songs ||
        searchResponse.data.result.songs.length === 0
      ) {
        throw new Error("未找到歌曲");
      }

      // 找到最匹配的歌曲
      const songs = searchResponse.data.result.songs;
      let bestMatch = null;
      let bestScore = 0;

      for (const song of songs) {
        let score = 0;
        const songTitle = song.name || "";
        const songArtist = song.artists?.[0]?.name || "";

        // 计算匹配度
        if (songTitle.toLowerCase().includes(title.toLowerCase())) score += 50;
        if (title.toLowerCase().includes(songTitle.toLowerCase())) score += 30;
        if (songArtist.toLowerCase().includes(artist.toLowerCase()))
          score += 30;
        if (artist.toLowerCase().includes(songArtist.toLowerCase()))
          score += 20;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = song;
        }
      }

      if (!bestMatch || bestScore < 50) {
        throw new Error("没有找到足够匹配的歌曲");
      }

      const songId = bestMatch.id;

      // 2. 获取歌词
      const lyricUrl = `https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`;
      const lyricResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: lyricUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://music.163.com/",
            Accept: "application/json, text/plain, */*",
          },
          timeout: 8000,
        });
      });

      const lyricData = lyricResponse.data;
      let lyrics = "";

      // 网易云歌词格式：原歌词 + 翻译
      if (lyricData.lrc && lyricData.lrc.lyric) {
        lyrics = lyricData.lrc.lyric;
      }

      if (lyricData.tlyric && lyricData.tlyric.lyric) {
        // 合并翻译歌词
        lyrics = this._mergeLyrics(lyrics, lyricData.tlyric.lyric);
      }

      if (lyricData.klyric && lyricData.klyric.lyric) {
        // 合并逐字歌词
        lyrics = lyrics + "\n\n" + lyricData.klyric.lyric;
      }

      return lyrics || null;
    } catch (error) {
      throw new Error(`网易云API错误: ${error.message}`);
    }
  },

  // 从QQ音乐获取歌词
  async _fetchFromQQMusic(title, artist) {
    try {
      // QQ音乐搜索API
      const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(`${title} ${artist}`)}&format=json&p=1&n=10`;
      const searchResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: searchUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://y.qq.com/",
            Origin: "https://y.qq.com",
          },
          timeout: 8000,
        });
      });

      const searchData = searchResponse.data;
      if (
        !searchData.data ||
        !searchData.data.song ||
        !searchData.data.song.list ||
        searchData.data.song.list.length === 0
      ) {
        throw new Error("未找到歌曲");
      }

      const song = searchData.data.song.list[0];
      const songMid = song.songmid;
      const songId = song.songid;

      // 获取歌词
      const lyricUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songMid}&format=json&nobase64=1`;
      const lyricResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: lyricUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://y.qq.com/",
            Accept: "application/json, text/javascript, */*",
          },
          timeout: 8000,
        });
      });

      let responseText = lyricResponse.data;

      // 处理JSONP响应
      if (
        typeof responseText === "string" &&
        responseText.includes("callback")
      ) {
        responseText = responseText.replace(/^callback\((.*)\)$/, "$1");
        responseText = JSON.parse(responseText);
      }

      if (responseText.lyric) {
        return decodeURIComponent(responseText.lyric);
      }

      return null;
    } catch (error) {
      throw new Error(`QQ音乐API错误: ${error.message}`);
    }
  },

  // 从 Lyrics.ovh 获取歌词
  async _fetchFromLyricsOvh(title, artist) {
    try {
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const response = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: url,
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 10000,
        });
      });

      if (response.data && response.data.lyrics) {
        return response.data.lyrics;
      }

      throw new Error("没有找到歌词");
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error("歌词不存在");
      }
      throw new Error(`Lyrics.ovh API错误: ${error.message}`);
    }
  },

  // 从酷狗音乐获取歌词
  async _fetchFromKugou(title, artist) {
    try {
      const searchUrl = `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(`${title} ${artist}`)}&page=1&pagesize=10`;
      const searchResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: searchUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "http://www.kugou.com/",
          },
          timeout: 8000,
        });
      });

      if (
        !searchResponse.data ||
        !searchResponse.data.data ||
        !searchResponse.data.data.info ||
        searchResponse.data.data.info.length === 0
      ) {
        throw new Error("未找到歌曲");
      }

      const song = searchResponse.data.data.info[0];
      const hash = song.hash;

      // 获取歌词
      const lyricUrl = `http://m.kugou.com/app/i/krc.php?cmd=100&hash=${hash}&timelength=999999`;
      const lyricResponse = await this._requestWithRetry(async () => {
        return axios({
          method: "GET",
          url: lyricUrl,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "http://m.kugou.com/",
          },
          timeout: 8000,
        });
      });

      // 酷狗返回的是KRC格式，需要转换
      if (lyricResponse.data) {
        const krcContent = lyricResponse.data;
        if (krcContent.includes("[") && krcContent.includes("]")) {
          // 简单的KRC到LRC转换
          return this._convertKrcToLrc(krcContent);
        }
      }

      return null;
    } catch (error) {
      throw new Error(`酷狗音乐API错误: ${error.message}`);
    }
  },

  // 从百度音乐获取歌词（备用）
  async _fetchFromBaidu(title, artist) {
    try {
      // 百度音乐已关闭，这里使用其他替代方案
      // 可以尝试从其他公开API获取
      return null;
    } catch (error) {
      throw new Error(`百度音乐API错误: ${error.message}`);
    }
  },

  // 合并原歌词和翻译歌词
  _mergeLyrics(originalLyric, translatedLyric) {
    if (!translatedLyric || !originalLyric) {
      return originalLyric || "";
    }

    const originalLines = originalLyric.split("\n");
    const translatedLines = translatedLyric.split("\n");

    // 创建时间戳到翻译的映射
    const translationMap = new Map();
    translatedLines.forEach((line) => {
      const timeMatch = line.match(/^\[(\d{2}:\d{2}\.\d{2})\]/);
      if (timeMatch) {
        const time = timeMatch[1];
        const text = line.substring(timeMatch[0].length).trim();
        if (text) {
          translationMap.set(time, text);
        }
      }
    });

    // 合并歌词
    let mergedLyrics = "";
    originalLines.forEach((line) => {
      const timeMatch = line.match(/^\[(\d{2}:\d{2}\.\d{2})\]/);
      if (timeMatch) {
        const time = timeMatch[1];
        const originalText = line.substring(timeMatch[0].length).trim();
        const translation = translationMap.get(time);

        mergedLyrics += line + "\n";
        if (translation && translation !== originalText) {
          mergedLyrics += `[${time}]${translation}\n`;
        }
      } else {
        mergedLyrics += line + "\n";
      }
    });

    return mergedLyrics.trim();
  },

  // 将KRC格式转换为LRC格式
  _convertKrcToLrc(krcContent) {
    try {
      // 简单的KRC转LRC
      let lrc = "";
      const lines = krcContent.split("\n");

      for (const line of lines) {
        // 匹配KRC的时间标签格式: [time,time]
        const timeMatches = line.match(/\[(\d+),(\d+)\]/g);
        if (timeMatches && timeMatches.length > 0) {
          const textStart = line.indexOf("]") + 1;
          let lyricsText = line.substring(textStart).trim();

          // 移除控制字符和<...>标签
          lyricsText = lyricsText.replace(/<[^>]+>/g, "").trim();

          if (lyricsText) {
            // 将KRC时间转换为LRC时间
            for (const timeMatch of timeMatches) {
              const ms = parseInt(timeMatch.match(/\d+/)[0]);
              const seconds = ms / 1000;
              const min = Math.floor(seconds / 60);
              const sec = (seconds % 60).toFixed(2).padStart(5, "0");
              const lrcTime = `[${min.toString().padStart(2, "0")}:${sec}]`;
              lrc += lrcTime + lyricsText + "\n";
            }
          }
        }
      }

      return lrc;
    } catch (error) {
      logger.warn("KRC转换失败:", error.message);
      return null;
    }
  },

  // 简化歌名（移除括号、版本信息等）
  _simplifyTitle(title) {
    if (!title) return "";

    let simplified = title;

    // 移除括号内容
    simplified = simplified.replace(/\([^)]*\)/g, "");
    simplified = simplified.replace(/\[[^\]]*\]/g, "");

    // 移除常见版本标识
    const versionPatterns = [
      / - .*version$/i,
      / \(.*version\)$/i,
      / - .*mix$/i,
      / \(.*mix\)$/i,
      / - .*edit$/i,
      / \(.*edit\)$/i,
      / - .*remaster(ed)?$/i,
      / \(.*remaster(ed)?\)$/i,
      / - .*live$/i,
      / \(.*live\)$/i,
      / - .*acoustic$/i,
      / \(.*acoustic\)$/i,
      / - .*cover$/i,
      / \(.*cover\)$/i,
      / - .*feat\.? .*$/i,
      / \(.*feat\.? .*\)$/i,
      / - .*ft\.? .*$/i,
      / \(.*ft\.? .*\)$/i,
    ];

    versionPatterns.forEach((pattern) => {
      simplified = simplified.replace(pattern, "");
    });

    // 清理多余空格
    simplified = simplified.trim();

    return simplified;
  },

  // 验证歌词格式
  _validateLyrics(lyrics) {
    if (!lyrics || typeof lyrics !== "string") {
      return false;
    }

    // 最小长度检查
    if (lyrics.trim().length < 10) {
      return false;
    }

    // 检查是否包含有效的时间标签（LRC格式）
    const hasTimeTags =
      /\[\d{2}:\d{2}\.\d{2}\]/.test(lyrics) ||
      /\[\d{2}:\d{2}\]/.test(lyrics) ||
      /\[\d{1,3}:\d{2}\]/.test(lyrics);

    // 或者有足够的文本内容
    const textContent = lyrics.replace(/\[.*?\]/g, "").trim();
    const hasEnoughText = textContent.length >= 20;

    return hasTimeTags || hasEnoughText;
  },

  // 清理歌词内容
  _cleanLyrics(lyrics) {
    if (!lyrics) return "";

    let cleaned = lyrics;

    // 移除BOM头
    cleaned = cleaned.replace(/^\uFEFF/, "");

    // 标准化换行符
    cleaned = cleaned.replace(/\r\n/g, "\n");
    cleaned = cleaned.replace(/\r/g, "\n");

    // 移除空行开头
    cleaned = cleaned.replace(/^\n+/, "");

    // 移除尾部的空行
    cleaned = cleaned.replace(/\n+$/, "");

    // 确保每行都有正确的格式
    const lines = cleaned.split("\n");
    const validLines = [];

    for (let line of lines) {
      line = line.trim();
      if (line) {
        // 如果是时间标签行，确保格式正确
        if (line.startsWith("[")) {
          // 修复常见的时间格式问题
          line = line.replace(
            /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g,
            (match, min, sec, ms) => {
              const minutes = min.padStart(2, "0");
              const seconds = sec.padStart(2, "0");
              const milliseconds = ms
                ? ms.padStart(2, "0").substring(0, 2)
                : "00";
              return `[${minutes}:${seconds}.${milliseconds}]`;
            },
          );
        }
        validLines.push(line);
      }
    }

    return validLines.join("\n");
  },

  // 等待函数
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  // 批量获取歌词（用于后台任务）
  async batchFetchLyrics(songs, callback = null) {
    try {
      const results = {
        success: 0,
        failed: 0,
        skipped: 0,
        total: songs.length,
        details: [],
      };

      // 并发控制参数
      const CONCURRENCY_LIMIT = 5; // 同时处理的最大歌曲数
      let completed = 0;
      let active = 0;
      let index = 0;

      // 处理单首歌曲的函数
      const processSong = async (songIndex) => {
        const song = songs[songIndex];
        active++;

        // 回调进度
        if (callback && typeof callback === "function") {
          callback({
            current: completed + active,
            total: songs.length,
            song: { id: song.id, title: song.title, artist: song.artist },
            status: "processing",
          });
        }

        try {
          logger.debug(
            `处理第 ${songIndex + 1}/${songs.length} 首: ${song.title} - ${song.artist}`,
          );

          // 如果已经有歌词，跳过
          if (song.lyricFile) {
            results.skipped++;
            results.details.push({
              songId: song.id,
              title: song.title,
              status: "skipped",
              reason: "已有歌词",
            });
            return;
          }

          // 获取歌词（自动使用重试机制）
          const lyrics = await this.fetchLyricsFromWeb(song.title, song.artist);

          if (lyrics) {
            // 保存歌词文件
            const lyricName = `lyric_${song.id}.lrc`;
            const lyricPath = path.join(CONFIG.LYRICS_DIR, lyricName);

            await fs.writeFile(lyricPath, lyrics, "utf8");

            // 更新数据库（这里需要数据库管理器支持更新单条记录）
            song.lyricFile = lyricName;

            results.success++;
            results.details.push({
              songId: song.id,
              title: song.title,
              status: "success",
              source: "web",
            });

            logger.info(`获取成功: ${song.title}`);
          } else {
            results.failed++;
            results.details.push({
              songId: song.id,
              title: song.title,
              status: "failed",
              reason: "未找到歌词",
            });
            logger.warn(`获取失败: ${song.title}`);
          }
        } catch (error) {
          results.failed++;
          results.details.push({
            songId: song.id,
            title: song.title,
            status: "error",
            error: error.message,
          });
          logger.error(`处理出错: ${song.title}`, error.message);
        } finally {
          active--;
          completed++;
        }
      };

      // 并发处理函数
      const processNext = async () => {
        while (active < CONCURRENCY_LIMIT && index < songs.length) {
          const currentIndex = index;
          index++;
          processSong(currentIndex).then(() => processNext());
        }
      };

      // 开始并行处理
      await processNext();

      // 等待所有处理完成
      while (active > 0) {
        await this.sleep(100);
      }

      return results;
    } catch (error) {
      logger.error("批量获取歌词失败:", error);
      throw error;
    }
  },
};

// 在 server.js 中添加
app.get("/api/recommendations/daily", (req, res) => {
  // 实现每日推荐逻辑
  // 例如：返回一些示例数据
  const dailyRecommendations = [
    { id: "1", title: "Song 1", artist: "Artist 1", duration: 240 },
    { id: "2", title: "Song 2", artist: "Artist 2", duration: 210 },
  ];
  res.json({ recommendations: dailyRecommendations });
});

// ======================== 清理功能 ========================
class CleanupManager {
  async cleanupOrphans() {
    try {
      const songs = dbManager.getAllSongs();
      const orphanRecords = [];
      const musicFiles = await fs.readdir(CONFIG.MUSIC_DIR);

      for (const song of songs) {
        if (!song || !song.filename) {
          orphanRecords.push(song);
          continue;
        }

        const fileExists = musicFiles.includes(path.basename(song.filename));
        if (!fileExists || !(await dbManager.fileExists(song.filePath))) {
          logger.debug(`发现孤儿记录: ${song.title} - ${song.artist}`);
          orphanRecords.push(song);
        }
      }

      if (orphanRecords.length > 0) {
        // 使用事务批量删除孤儿记录
        const orphanIds = orphanRecords.map((song) => song.id);
        if (orphanIds.length > 0) {
          // 使用事务确保级联删除的一致性
          dbManager.db.transaction((ids) => {
            const stmt = dbManager.db.prepare("DELETE FROM songs WHERE id = ?");
            for (const id of ids) {
              stmt.run(id);
            }
          })(orphanIds);
        }
      }

      return {
        success: true,
        type: "orphans",
        removedCount: orphanRecords.length,
        totalSongs: songs.length,
        removedSongs: orphanRecords.map((song) => ({
          id: song.id,
          title: song.title,
          artist: song.artist,
          filename: song.filename,
          reason: "文件不存在",
        })),
      };
    } catch (error) {
      logger.error("清理孤儿记录失败:", error);
      return { success: false, type: "orphans", error: error.message };
    }
  }

  async cleanupDuplicates() {
    try {
      logger.info("开始清理重复记录...");
      const songs = dbManager.getAllSongs();

      // 按哈希值分组
      const hashGroups = new Map();
      const skippedSongs = [];

      for (const song of songs) {
        if (
          !song.fileHash ||
          !song.filePath ||
          !(await dbManager.fileExists(song.filePath))
        ) {
          skippedSongs.push(song);
          continue;
        }

        try {
          const exists = await dbManager.fileExists(song.filePath);
          if (!exists) {
            skippedSongs.push(song);
            continue;
          }
        } catch (err) {
          skippedSongs.push(song);
          continue;
        }

        if (!hashGroups.has(song.fileHash)) {
          hashGroups.set(song.fileHash, []);
        }
        hashGroups.get(song.fileHash).push(song);
      }

      // 识别重复项
      const duplicates = [];
      const toDelete = [];

      for (const [hash, songGroup] of hashGroups.entries()) {
        if (songGroup.length > 1) {
          songGroup.sort(
            (a, b) => new Date(a.uploadDate) - new Date(b.uploadDate),
          );
          const keepSong = songGroup[0];

          logger.debug(
            `发现重复文件组 (${songGroup.length}个): ${keepSong.title}`,
          );

          for (let i = 1; i < songGroup.length; i++) {
            const song = songGroup[i];
            duplicates.push({
              hash,
              keep: {
                id: keepSong.id,
                title: keepSong.title,
                artist: keepSong.artist,
                filename: keepSong.filename,
              },
              delete: {
                id: song.id,
                title: song.title,
                artist: song.artist,
                filename: song.filename,
              },
            });
            toDelete.push(song);
          }
        }
      }

      // 删除重复文件
      let deletedCount = 0;
      let savedSpace = 0;

      for (const song of toDelete) {
        try {
          if (song.filePath) {
            const stats = await fs.stat(song.filePath);
            savedSpace += stats.size;
            await fs.unlink(song.filePath);
          }

          if (song.lyricFile) {
            const lyricPath = FileSecurity.resolveSafePath(
              CONFIG.LYRICS_DIR,
              song.lyricFile,
            );
            await fs.unlink(lyricPath);
          }

          if (song.coverUrl) {
            const coverName = song.coverUrl.replace("/api/covers/", "");
            const coverPath = FileSecurity.resolveSafePath(
              CONFIG.COVERS_DIR,
              coverName,
            );
            await fs.unlink(coverPath);
          }

          deletedCount++;
        } catch (error) {
          logger.error(`删除失败 ${song.title}:`, error.message);
        }
      }

      // 从数据库删除重复记录
      const deletedIds = toDelete.map((song) => song.id);
      if (deletedIds.length > 0) {
        // 使用事务批量删除，确保级联删除的一致性
        dbManager.db.transaction((ids) => {
          const stmt = dbManager.db.prepare("DELETE FROM songs WHERE id = ?");
          for (const id of ids) {
            stmt.run(id);
          }
        })(deletedIds);
      }

      logger.info(
        `清理完成: ${deletedCount}个重复文件, 节省 ${(savedSpace / (1024 * 1024)).toFixed(2)}MB`,
      );

      return {
        success: true,
        type: "duplicates",
        removedCount: deletedCount,
        savedSpace: Math.round((savedSpace / (1024 * 1024)) * 100) / 100,
        duplicatesFound: duplicates.length,
        // details: {
        //     totalSongs: remainingSongs.length,
        //     validSongs: remainingSongs.length - skippedSongs.length,
        //     skippedSongs: skippedSongs.length,
        //     duplicateGroups: hashGroups.size - (new Set(hashGroups.keys()).size),
        // },
      };
    } catch (error) {
      logger.error("清理重复记录失败:", error);
      return { success: false, type: "duplicates", error: error.message };
    }
  }

  constructor() {
    this.isRunning = false; // 添加运行锁
    this.lastRunTime = 0; // 记录上次运行时间
    this.MIN_INTERVAL = 60 * 1000; // 最小运行间隔1分钟
  }

  async performAutoCleanup() {
    // 防止重复执行
    if (this.isRunning) {
      logger.warn("清理任务正在运行中，跳过本次执行");
      return;
    }

    const now = Date.now();
    if (now - this.lastRunTime < this.MIN_INTERVAL) {
      logger.debug(
        `距离上次清理不足${this.MIN_INTERVAL / 1000}秒，跳过本次执行`,
      );
      return;
    }

    this.isRunning = true;
    this.lastRunTime = now;

    try {
      logger.info("开始执行自动清理...");
      const results = [];

      const orphanResult = await this.cleanupOrphans();
      results.push(orphanResult);

      if (orphanResult.removedCount > CONFIG.MAX_ORPHAN_RECORDS) {
        wsServer.broadcastToAll({
          type: "library_warning",
          data: {
            type: "too_many_orphans",
            count: orphanResult.removedCount,
            message: `自动清理了 ${orphanResult.removedCount} 个孤儿记录，请检查文件系统`,
          },
        });
      }

      await utils.sleep(1000); // 添加延迟，避免连续操作
      const duplicateResult = await this.cleanupDuplicates();
      results.push(duplicateResult);

      const totalRemoved =
        orphanResult.removedCount + duplicateResult.removedCount;
      if (totalRemoved > 0) {
        wsServer.broadcastToAll({
          type: "library_cleaned",
          data: {
            type: "auto_cleanup",
            count: totalRemoved,
            message: `自动清理完成，共清理了 ${totalRemoved} 条无效记录`,
          },
        });
      }

      logger.info("自动清理完成", results);
      return results;
    } catch (error) {
      logger.error("自动清理失败:", error);
      throw error;
    } finally {
      this.isRunning = false; // 释放锁
    }
  }

  // 添加工具函数
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const cleanupManager = new CleanupManager();

// ======================== 音频处理 ========================
class AudioProcessor {
  async calculateHash(filePath) {
    try {
      const fileHandle = await fs.open(filePath, "r");
      const hash = crypto.createHash("sha256");
      const buffer = Buffer.alloc(64 * 1024);
      let totalRead = 0;
      const maxSize = 500 * 1024 * 1024;

      while (true) {
        const { bytesRead } = await fileHandle.read(
          buffer,
          0,
          buffer.length,
          null,
        );
        if (bytesRead === 0) break;

        totalRead += bytesRead;
        if (totalRead > maxSize) {
          await fileHandle.close();
          throw new Error("文件过大");
        }
        hash.update(buffer.slice(0, bytesRead));
      }

      await fileHandle.close();
      return hash.digest("hex");
    } catch (error) {
      throw new Error(`计算文件哈希失败: ${error.message}`);
    }
  }

  async extractMetadata(filePath) {
    try {
      const metadata = await mm.parseFile(filePath, { duration: true });
      return {
        title: metadata.common.title,
        artist: metadata.common.artist,
        album: metadata.common.album,
        year: metadata.common.year,
        genre: metadata.common.genre,
        duration: Math.round(metadata.format.duration || 0),
        bitrate: metadata.format.bitrate,
        format: metadata.format.codec,
        picture: metadata.common.picture,
        lyrics: metadata.common.lyrics,
      };
    } catch (error) {
      logger.warn("提取元数据失败:", error.message);
      return {};
    }
  }

  parseFromFilename(filename) {
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    let title = nameWithoutExt;
    let artist = "未知艺术家";
    let album = "未知专辑";

    const dashParts = nameWithoutExt.split(" - ");
    if (dashParts.length >= 2) {
      artist = dashParts[0].trim();
      title = dashParts[1].trim();
      if (dashParts.length >= 3) {
        album = dashParts[2].trim();
      }
    }

    return { title, artist, album, displayName: nameWithoutExt };
  }
}

const audioProcessor = new AudioProcessor();

// ======================== 元数据匹配服务 ========================
const acoustid = require("acoustid"); // 需 npm install acoustid

class MetadataService {
  constructor() {
    // 这里的 Key 是 AcoustID 的公共演示 Key，建议去 acoustid.org 申请自己的
    this.ACOUSTID_CLIENT_KEY = "8XaBELgH";
  }

  /**
   * 策略模式：尝试获取元数据
   * 1. 尝试音频指纹 (AcoustID)
   * 2. 失败则尝试文件名搜索 (网易云/QQ)
   */
  async identifySong(filePath, currentMetadata) {
    logger.info(`开始识别歌曲: ${currentMetadata.displayName}`);
    let result = null;

    // 策略1: 音频指纹识别 (最准确)
    try {
      result = await this.identifyByFingerprint(filePath);
    } catch (e) {
      logger.warn("指纹识别失败/跳过:", e.message);
    }

    // 策略2: 如果指纹失败，使用文件名搜索 (网易云/QQ)
    if (!result) {
      logger.debug("尝试通过文件名搜索...");
      // 优先使用已有的 title/artist，如果没有则使用文件名
      const query =
        currentMetadata.title && currentMetadata.artist !== "未知艺术家"
          ? `${currentMetadata.title} ${currentMetadata.artist}`
          : currentMetadata.displayName;

      result = await this.searchOnlineDatabase(query);
    }

    return result;
  }

  // 基于 AcoustID 的指纹识别
  async identifyByFingerprint(filePath) {
    return new Promise((resolve, reject) => {
      // 使用 acoustid 库调用 fpcalc
      acoustid(filePath, { key: this.ACOUSTID_CLIENT_KEY }, (err, results) => {
        if (err) return reject(err);
        if (!results || results.length === 0)
          return reject(new Error("未找到指纹匹配"));

        // 获取匹配度最高的结果
        const match = results[0];
        if (!match.recordings || match.recordings.length === 0)
          return reject(new Error("无录音数据"));

        const recording = match.recordings[0];
        const artist = recording.artists
          ? recording.artists[0].name
          : "Unknown";
        const title = recording.title;

        // MusicBrainz 通常不直接提供封面，这里我们拿到准确的 歌名+歌手 后，
        // 再去网易云/QQ 搜索一次以获取高质量封面和专辑信息
        this.searchOnlineDatabase(`${title} ${artist}`)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  // 扩展原有的搜索逻辑，获取完整元数据
  async searchOnlineDatabase(keyword) {
    // 这里复用并增强你原有的 utils 中的搜索逻辑
    // 尝试网易云 (通常最全)
    try {
      const data = await this._searchNetease(keyword);
      if (data) return data;
    } catch (e) {
      logger.warn("网易云搜索失败:", e.message);
    }

    // 尝试 QQ 音乐
    try {
      const data = await this._searchQQ(keyword);
      if (data) return data;
    } catch (e) {
      logger.warn("QQ搜索失败:", e.message);
    }

    return null;
  }

  async _searchNetease(keyword) {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=1`;
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (res.data?.result?.songs?.[0]) {
      const song = res.data.result.songs[0];
      return {
        title: song.name,
        artist: song.artists[0].name,
        album: song.album.name,
        coverUrl: song.album.picUrl, // 网易云封面
        year: new Date(song.album.publishTime).getFullYear(),
        source: "netease",
      };
    }
    return null;
  }

  async _searchQQ(keyword) {
    const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&format=json&n=1`;
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://y.qq.com" },
    });

    if (res.data?.data?.song?.list?.[0]) {
      const song = res.data.data.song.list[0];
      // QQ音乐封面构造
      const albumId = song.albummid;
      const coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumId}.jpg`;

      return {
        title: song.songname,
        artist: song.singer[0].name,
        album: song.albumname,
        coverUrl: coverUrl,
        source: "qq",
      };
    }
    return null;
  }
}

const metadataService = new MetadataService();

// ======================== 启动服务器 ========================
async function startServer() {
  try {
    await dbManager.init(); // SQLite 初始化

    const httpServer = app.listen(CONFIG.PORT, CONFIG.HOST, () => {
      logger.info("=".repeat(60));
      logger.info("服务器启动成功");
      logger.info(`端口: ${CONFIG.PORT}`);
      logger.info(`环境: ${config.NODE_ENV}`);
      logger.info(`音乐目录: ${CONFIG.MUSIC_DIR}`);
      logger.info(`数据库: ${dbManager.dbFile}`);
      logger.info(
        `访问地址: http://${CONFIG.HOST === "0.0.0.0" ? "localhost" : CONFIG.HOST}:${CONFIG.PORT}`,
      );
      logger.info("=".repeat(60));
    });

    wsServer.init(httpServer);

    // 定期自动清理
    // setInterval(async () => {
    //     await cleanupManager.performAutoCleanup();
    // }, CONFIG.AUTO_CLEANUP_INTERVAL);

    // 延迟5秒再启动定时任务，确保服务器完全就绪
    setTimeout(() => {
      logger.info(
        `启动自动清理任务，间隔: ${CONFIG.AUTO_CLEANUP_INTERVAL / (60 * 60 * 1000)} 小时`,
      );

      // 使用setInterval并添加错误捕获
      const cleanupInterval = setInterval(async () => {
        try {
          logger.debug("触发定时清理任务...");
          await cleanupManager.performAutoCleanup();
        } catch (error) {
          logger.error("定时清理任务执行失败:", error);
        }
      }, CONFIG.AUTO_CLEANUP_INTERVAL);

      // 将interval ID存储，方便后续清理
      global.cleanupIntervalId = cleanupInterval;
    }, 5000);

    // 优雅关闭
    const shutdown = async () => {
      logger.info("正在关闭服务器...");

      // 停止定时任务
      if (global.cleanupIntervalId) {
        clearInterval(global.cleanupIntervalId);
      }

      // 关闭WebSocket服务器
      wsServer.close();

      // 关闭数据库连接
      try {
        if (dbManager) {
          logger.debug("正在关闭数据库连接...");
          dbManager.close();
          logger.info("数据库连接已关闭");
        }
      } catch (error) {
        logger.error("关闭数据库连接失败:", error);
      }

      // 关闭HTTP服务器
      httpServer.close(() => {
        logger.info("服务器已关闭");
        process.exit(0);
      });

      // 超时强制关闭
      setTimeout(() => {
        logger.error("强制关闭服务器");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("未处理的Rejection:", reason);
      logger.error("Promise:", promise);
    });

    process.on("uncaughtException", (error) => {
      logger.error("未捕获的异常:", error);
      if (config.NODE_ENV === "production") {
        setTimeout(() => process.exit(1), 5000);
      }
    });
  } catch (error) {
    logger.error("服务器启动失败:", error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, dbManager, wsServer, cleanupManager };
