-- 歌曲主表
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    original_filename TEXT,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    year INTEGER,
    genre TEXT,
    duration INTEGER DEFAULT 0,
    format TEXT,
    file_path TEXT NOT NULL,
    file_url TEXT,
    cover_url TEXT,
    lyric_file TEXT,
    upload_date TEXT NOT NULL,
    play_count INTEGER DEFAULT 0,
    file_hash TEXT UNIQUE,
    file_size INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 播放历史表
CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT NOT NULL,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- 收藏表 (为未来多用户预留 user_id)
CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- 上传队列表 (替代内存队列)
CREATE TABLE IF NOT EXISTS upload_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT,
    size INTEGER,
    status TEXT DEFAULT 'pending', -- pending, uploading, success, error
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_songs_file_hash ON songs(file_hash);
CREATE INDEX idx_songs_title ON songs(title);
CREATE INDEX idx_songs_artist ON songs(artist);
CREATE INDEX idx_songs_upload_date ON songs(upload_date DESC);
CREATE INDEX idx_play_history_song_id ON play_history(song_id);
CREATE INDEX idx_play_history_played_at ON play_history(played_at DESC);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_songs_timestamp 
AFTER UPDATE ON songs FOR EACH ROW
BEGIN
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS update_upload_queue_timestamp 
AFTER UPDATE ON upload_queue FOR EACH ROW
BEGIN
    UPDATE upload_queue SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;