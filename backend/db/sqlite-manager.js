const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs").promises;

function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

// ✅ 关键修复：增强 cleanValue 函数，处理数组和对象
function cleanValue(val) {
  // 1. 处理 undefined 和 null
  if (val === undefined || val === null) {
    return null;
  }

  // 2. 处理字符串、数字、布尔值（直接返回）
  if (
    typeof val === "string" ||
    typeof val === "number" ||
    typeof val === "boolean"
  ) {
    return val;
  }

  // 3. 处理 BigInt
  if (typeof val === "bigint") {
    return val;
  }

  // 4. 处理 Buffer
  if (Buffer.isBuffer(val)) {
    return val;
  }

  // 5. 处理数组（转换为逗号分隔字符串）
  if (Array.isArray(val)) {
    // 如果是空数组，返回 null
    if (val.length === 0) return null;
    // 否则转换为逗号分隔字符串
    return val.join(", ");
  }

  // 6. 处理对象（转换为 JSON 字符串）
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch (e) {
      return null;
    }
  }

  // 7. 其他情况返回 null
  return null;
}

class SQLiteManager {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async init() {
    const dbPath = path.join(__dirname, "../data/music.db");

    // 确保 data 目录存在
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    // 连接数据库 (创建文件如果不存在)
    this.db = new Database(dbPath, {
      verbose: process.env.NODE_ENV === "development" ? console.log : null,
    });

    // 启用 WAL 模式 (提升并发性能)
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;"); // 平衡性能与安全性

    // ✅ 关键修复：检查表是否存在
    const tableExists = this.db
      .prepare(
        `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='songs'
    `,
      )
      .get();

    if (!tableExists) {
      // 只在首次运行时执行建表语句
      const schemaPath = path.join(__dirname, "schema.sql");
      const schema = await fs.readFile(schemaPath, "utf-8");
      this.db.exec(schema);
      console.log("📦 首次运行，创建数据库表结构");
    } else {
      console.log("✅ 数据库表已存在，跳过创建");
    }

    this.initialized = true;
    console.log("✅ SQLite 数据库初始化完成");

    // 数据迁移检查
    await this.checkAndMigrate();
  }

  async checkAndMigrate() {
    const oldDbPath = path.join(__dirname, "../data/music.json");
    try {
      await fs.access(oldDbPath);
      console.log("📦 检测到旧版 JSON 数据库，开始迁移...");

      const oldData = JSON.parse(await fs.readFile(oldDbPath, "utf-8"));
      const songs = oldData.songs || [];

      if (songs.length === 0) {
        console.log("✅ 旧数据库为空，跳过迁移");
        await fs.rename(oldDbPath, oldDbPath + ".migrated");
        return;
      }

      // ✅ 使用模块级函数，无需捕获
      const insertMany = this.db.transaction((songs) => {
        const insert = this.db.prepare(`
                    INSERT OR IGNORE INTO songs (
                        id, filename, original_filename, title, artist, album, year, genre,
                        duration, format, file_path, file_url, cover_url, lyric_file,
                        upload_date, play_count, file_hash
                    ) VALUES (
                        @id, @filename, @originalFilename, @title, @artist, @album, @year, @genre,
                        @duration, @format, @filePath, @fileUrl, @coverUrl, @lyricFile,
                        @uploadDate, @playCount, @fileHash
                    )
                `);

        for (const song of songs) {
          insert.run({
            id: cleanValue(song.id), // ✅ 直接调用模块级函数
            filename: cleanValue(song.filename),
            originalFilename: cleanValue(
              song.originalFilename || song.filename,
            ),
            title: cleanValue(song.title),
            artist: cleanValue(song.artist),
            album: cleanValue(song.album),
            year: cleanValue(song.year),
            genre: cleanValue(song.genre),
            duration: cleanValue(song.duration) || 0,
            format: cleanValue(song.format),
            filePath: cleanValue(song.filePath),
            fileUrl: cleanValue(song.fileUrl),
            coverUrl: cleanValue(song.coverUrl),
            lyricFile: cleanValue(song.lyricFile),
            uploadDate: cleanValue(song.uploadDate),
            playCount: cleanValue(song.playCount) || 0,
            fileHash: cleanValue(song.fileHash),
          });
        }
      });

      insertMany(songs);

      const favoritesPath = path.join(
        __dirname,
        "../data/musicPlayerFavorites.json",
      );
      try {
        const favoritesData = JSON.parse(
          await fs.readFile(favoritesPath, "utf-8"),
        );
        for (const songId of favoritesData) {
          this.db
            .prepare("INSERT OR IGNORE INTO favorites (song_id) VALUES (?)")
            .run(songId);
        }
        console.log(`✅ 迁移收藏: ${favoritesData.length} 条记录`);
      } catch (e) {
        console.log("⚠️ 未找到收藏数据，跳过");
      }

      await fs.rename(oldDbPath, oldDbPath + ".migrated");
      console.log(`✅ 数据迁移完成！共迁移 ${songs.length} 首歌曲`);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("✅ 未检测到旧版数据库，跳过迁移");
      } else {
        console.error("迁移失败:", error);
        throw error;
      }
    }
  }

  // 歌曲相关操作
  getAllSongs() {
    const stmt = this.db.prepare(
      "SELECT * FROM songs ORDER BY upload_date DESC",
    );
    const rows = stmt.all();

    // 将 snake_case 转换为 camelCase
    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  getSongById(id) {
    const stmt = this.db.prepare("SELECT * FROM songs WHERE id = ?");
    const row = stmt.get(id);
    if (!row) return null;

    const song = {};
    for (const key in row) {
      if (row.hasOwnProperty(key)) {
        song[toCamelCase(key)] = row[key];
      }
    }
    return song;
  }

  getSongsByIds(ids) {
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT * FROM songs WHERE id IN (${placeholders})`,
    );
    const rows = stmt.all(...ids);

    // 将 snake_case 转换为 camelCase
    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  addSong(song) {
    // 生成唯一ID（使用时间戳+随机数）
    const id =
      cleanValue(song.id) ||
      `song_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const stmt = this.db.prepare(`
        INSERT INTO songs (
            id, filename, original_filename, title, artist, album, year, genre,
            duration, format, file_path, file_url, cover_url, lyric_file,
            upload_date, play_count, file_hash, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      id,
      cleanValue(song.filename),
      cleanValue(song.originalFilename || song.filename),
      cleanValue(song.title),
      cleanValue(song.artist),
      cleanValue(song.album),
      cleanValue(song.year),
      cleanValue(song.genre),
      cleanValue(song.duration) || 0,
      cleanValue(song.format),
      cleanValue(song.filePath),
      cleanValue(song.fileUrl),
      cleanValue(song.coverUrl),
      cleanValue(song.lyricFile),
      cleanValue(song.uploadDate),
      cleanValue(song.playCount) || 0,
      cleanValue(song.fileHash),
      cleanValue(song.fileSize) || 0,
    );

    return id;
  }

  updateSong(id, updates) {
    const fields = Object.keys(updates)
      .map((key) => `${this.toSnakeCase(key)} = ?`)
      .join(", ");
    const values = Object.values(updates);
    values.push(id);

    const stmt = this.db.prepare(`UPDATE songs SET ${fields} WHERE id = ?`);
    return stmt.run(...values).changes;
  }

  deleteSong(id) {
    // 使用事务确保数据一致性，实现级联删除
    return this.db.transaction((songId) => {
      // 删除收藏记录
      this.db.prepare("DELETE FROM favorites WHERE song_id = ?").run(songId);

      // 删除播放历史记录
      this.db.prepare("DELETE FROM play_history WHERE song_id = ?").run(songId);

      // 删除歌曲记录
      const stmt = this.db.prepare("DELETE FROM songs WHERE id = ?");
      return stmt.run(songId).changes;
    })(id);
  }

  getSongByFileHash(hash) {
    const stmt = this.db.prepare("SELECT * FROM songs WHERE file_hash = ?");
    const row = stmt.get(hash);
    if (!row) return null;

    const song = {};
    for (const key in row) {
      if (row.hasOwnProperty(key)) {
        song[toCamelCase(key)] = row[key];
      }
    }
    return song;
  }

  // 分页查询
  getSongsPaginated(page = 1, limit = 100) {
    const offset = (page - 1) * limit;
    const stmt = this.db.prepare(`
            SELECT * FROM songs 
            ORDER BY upload_date DESC 
            LIMIT ? OFFSET ?
        `);
    const rows = stmt.all(limit, offset);

    // 将 snake_case 转换为 camelCase
    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  // 搜索 (全文搜索优化)
  searchSongs(query) {
    const search = `%${query.toLowerCase()}%`;
    const stmt = this.db.prepare(`
        SELECT * FROM songs 
        WHERE LOWER(title) LIKE ? OR LOWER(artist) LIKE ? OR LOWER(album) LIKE ?
        ORDER BY upload_date DESC
    `);
    const rows = stmt.all(search, search, search);

    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  // 统计信息
  // 在 SQLiteManager 类中添加或确认此方法存在

  getStats() {
    const stmt = this.db.prepare(`
        SELECT 
            COUNT(*) as total_songs,
            SUM(duration) as total_duration,
            SUM(file_size) as total_size
        FROM songs
    `);
    const result = stmt.get();

    return {
      totalSongs: result.total_songs || 0,
      totalDuration: result.total_duration || 0,
      totalSize: result.total_size || 0,
      totalSizeMB: Math.round((result.total_size || 0) / (1024 * 1024)),
    };
  }

  // 收藏相关
  getFavoriteSongIds() {
    const stmt = this.db.prepare("SELECT song_id FROM favorites");
    return stmt.all().map((row) => row.song_id);
  }

  getFavoriteSongs() {
    const stmt = this.db.prepare(`
            SELECT s.* FROM songs s
            JOIN favorites f ON s.id = f.song_id
            ORDER BY f.created_at DESC
        `);
    const rows = stmt.all();

    // 将 snake_case 转换为 camelCase
    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  toggleFavorite(songId) {
    const exists = this.db
      .prepare("SELECT 1 FROM favorites WHERE song_id = ?")
      .get(songId);
    if (exists) {
      this.db.prepare("DELETE FROM favorites WHERE song_id = ?").run(songId);
      return false;
    } else {
      this.db.prepare("INSERT INTO favorites (song_id) VALUES (?)").run(songId);
      return true;
    }
  }

  // 播放历史
  addToHistory(songId) {
    const stmt = this.db.prepare(
      "INSERT INTO play_history (song_id, played_at) VALUES (?, CURRENT_TIMESTAMP)",
    );
    stmt.run(songId);
  }

  getPlayHistory(limit = 50) {
    const stmt = this.db.prepare(`
            SELECT s.*, MAX(h.played_at) as last_played
            FROM play_history h
            JOIN songs s ON h.song_id = s.id
            GROUP BY h.song_id
            ORDER BY last_played DESC
            LIMIT ?
        `);
    const rows = stmt.all(limit);

    // 将 snake_case 转换为 camelCase
    return rows.map((row) => {
      const song = {};
      for (const key in row) {
        if (row.hasOwnProperty(key)) {
          song[toCamelCase(key)] = row[key];
        }
      }
      return song;
    });
  }

  // 上传队列 (替代内存队列)
  addToUploadQueue(fileInfo) {
    const stmt = this.db.prepare(`
            INSERT INTO upload_queue (filename, original_path, size, status)
            VALUES (?, ?, ?, 'pending')
        `);
    return stmt.run(fileInfo.name, fileInfo.path, fileInfo.size)
      .lastInsertRowid;
  }

  getUploadQueue() {
    const stmt = this.db.prepare(
      "SELECT * FROM upload_queue ORDER BY created_at ASC",
    );
    return stmt.all();
  }

  updateUploadStatus(id, status, progress = 0, error = null) {
    const stmt = this.db.prepare(`
            UPDATE upload_queue 
            SET status = ?, progress = ?, error_message = ?
            WHERE id = ?
        `);
    stmt.run(status, progress, error, id);
  }

  clearUploadQueue() {
    this.db.prepare("DELETE FROM upload_queue").run();
  }

  // 歌词相关
  getSongsWithoutLyrics(limit = 100) {
    const stmt = this.db.prepare(`
            SELECT * FROM songs 
            WHERE lyric_file IS NULL 
            ORDER BY upload_date DESC
            LIMIT ?
        `);
    return stmt.all(limit);
  }

  updateSongLyrics(songId, lyricFile) {
    const stmt = this.db.prepare(
      "UPDATE songs SET lyric_file = ? WHERE id = ?",
    );
    return stmt.run(lyricFile, songId).changes;
  }

  // 工具方法
  toSnakeCase(str) {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // 关闭数据库连接
  close() {
    if (this.db && this.initialized) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log("✅ SQLite 数据库连接已关闭");
    }
  }
}

// 导出类和实例，支持测试和正常使用
module.exports = new SQLiteManager();
module.exports.SQLiteManager = SQLiteManager;
