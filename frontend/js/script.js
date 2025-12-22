// javascript <script></script> 标签内容

/**************************************
 * 🎵 稳定版音频播放器核心
 **************************************/

// 唯一音频实例
// 使用dom对象中的音频播放器引用
// const audioPlayer = dom.audioPlayer; // 移至dom对象定义后初始化

// Web Audio相关的变量已移至state对象中

// 播放器状态
const playerState = {
  currentTrack: null,
  isPlaying: false,
  isSwitching: false,
};

function logAudioError(error) {
  if (!error) return;

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      console.error("播放被用户中止");
      break;
    case MediaError.MEDIA_ERR_NETWORK:
      console.error("网络错误，无法加载音频文件");
      break;
    case MediaError.MEDIA_ERR_DECODE:
      console.error("音频解码失败，文件可能已损坏");
      break;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      console.error("音频格式不支持或URL无效");
      break;
    default:
      console.error("未知音频错误:", error);
  }
}

// initWebAudioOnce 已合并到 utils.initializeAudioContext 中

// 全局错误处理函数 - 统一定义
function handleCoverError(imgElement, title) {
  if (!imgElement || !imgElement.parentElement) return;

  imgElement.style.display = "none";
  const placeholder = document.createElement("div");
  placeholder.className = "music-cover-placeholder";
  placeholder.innerHTML = '<i class="fas fa-music"></i>';
  imgElement.parentElement.appendChild(placeholder);
}

// 应用配置
const CONFIG = {
  API_BASE_URL: "http://localhost:3000/api",
  UPLOAD_MAX_SIZE: 100 * 1024 * 1024, // 100MB
  SUPPORTED_FORMATS: [
    "mp3",
    "wav",
    "flac",
    "aac",
    "ogg",
    "m4a",
    "webm",
    "mpeg",
  ],
  WEBSOCKET_URL: "ws://localhost:3000",
  CACHE_DURATION: 5 * 60 * 1000, // 5分钟缓存
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BACKGROUND_PLAYBACK: true, // 启用后台播放
  SUSPEND_TIMEOUT: 5 * 60 * 1000, // 5分钟后挂起音频上下文
  WAKE_LOCK_SUPPORT: "wakeLock" in navigator, // 检查是否支持唤醒锁
  SUPPORTED_AUDIO_FORMATS: [
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "aac",
    "flac",
    "webm",
    "opus",
    "wma",
    "aiff",
    "mpeg",
  ],
  AUDIO_MIME_TYPES: {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    webm: "audio/webm",
  },
  // 性能配置
  MAX_SONG_CACHE_SIZE: 10000,
  LYRICS_SCROLL_DURATION: 20, // 秒后重置
  SEARCH_DEBOUNCE_MS: 300,
  UI_UPDATE_INTERVAL_MS: 1000,
};

// 应用状态
// 替换现有的 state 对象定义
const state = {
  // 音乐数据（确保初始化为数组）
  library: [],
  favorites: [],
  history: [],
  dailyRecommendations: [],
  featuredTracks: [],

  // 播放状态
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  isMuted: false,
  isShuffled: false,
  repeatMode: "none",

  // 后台播放状态
  backgroundPlaybackEnabled: true,
  audioContext: null,
  audioSource: null,
  audioContextSuspended: false,
  wakeLock: null,
  lastActiveTime: Date.now(),

  audioContextResuming: false, // 添加一个标志位来跟踪上下文是否正在恢复

  // 页面可见性
  pageVisible: true,

  // 应用状态
  currentPage: "home",
  theme: "dark",
  settings: {
    autoPlay: true,
    highQuality: false,
    showLyrics: true,
    playerLyricsEnabled: true,
    backgroundPlayback: true,
  },

  // 上传队列
  uploadQueue: [],
  isUploading: false,
  uploadLock: false, // 添加一个锁来防止重复上传

  // 歌词
  currentLyrics: null,
  lyricsPanelOpen: false,

  // 播放器歌词状态
  playerCurrentLyric: null,
  lyricsScrollInterval: null,

  // 音乐源管理
  musicSources: [],
  isImportingSource: false,

  // WebSocket
  ws: null,
  wsReconnectAttempts: 0,
  maxWsReconnectAttempts: 10,

  // 缓存
  cache: new Map(),
  lastCacheUpdate: 0,

  // 性能优化
  songIndexById: new Map(),
  initialized: false,
};

// 添加防御性 getter/setter（在 state 定义后）
// Object.defineProperty(state, 'history', {
//     get() {
//         return this._history || [];
//     },
//     set(value) {
//         this._history = Array.isArray(value) ? value : [];
//     }
// });

// 同样保护其他数组属性
["library", "favorites", "dailyRecommendations", "featuredTracks"].forEach(
  (key) => {
    Object.defineProperty(state, key, {
      get() {
        return this[`_${key}`] || [];
      },
      set(value) {
        this[`_${key}`] = Array.isArray(value) ? value : [];
      },
    });
  },
);

// 全局错误处理
window.addEventListener("error", (event) => {
  console.error("⚠️ 全局错误捕获:", event.error);
  // 可以在这里添加错误上报逻辑
});

// 未处理的Promise rejection处理
window.addEventListener("unhandledrejection", (event) => {
  console.error("⚠️ 未处理的Promise rejection:", event.reason);
  event.preventDefault(); // 防止默认行为（浏览器控制台显示错误）
});

// DOM元素缓存
const dom = {
  // 布局元素
  appContainer: document.querySelector(".app-container"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  contentArea: document.getElementById("contentArea"),

  // 主题切换
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  themeSwitch: document.getElementById("themeSwitch"),

  // 导航
  navItems: document.querySelectorAll(".nav-item"),
  backButton: document.getElementById("backButton"),
  forwardButton: document.getElementById("forwardButton"),

  // 搜索
  searchInput: document.getElementById("searchInput"),

  // 用户操作
  uploadButton: document.getElementById("uploadButton"),
  notificationButton: document.getElementById("notificationButton"),
  lyricsButton: document.getElementById("lyricsButton"),
  lyricsBadge: document.getElementById("lyricsBadge"),
  settingsButton: document.getElementById("settingsButton"),
  userAvatar: document.getElementById("userAvatar"),

  // 页面
  pages: {
    home: document.getElementById("homePage"),
    daily: document.getElementById("dailyPage"),
    library: document.getElementById("libraryPage"),
    upload: document.getElementById("uploadPage"),
    favorites: document.getElementById("favoritesPage"),
    settings: document.getElementById("settingsPage"),
  },

  // 徽章
  dailyBadge: document.getElementById("dailyBadge"),
  libraryBadge: document.getElementById("libraryBadge"),

  // 首页元素
  totalSongs: document.getElementById("totalSongs"),
  totalArtists: document.getElementById("totalArtists"),
  totalDuration: document.getElementById("totalDuration"),
  todayRecommend: document.getElementById("todayRecommend"),
  quickUpload: document.getElementById("quickUpload"),
  refreshLibrary: document.getElementById("refreshLibrary"),
  featuredGrid: document.getElementById("featuredGrid"),
  recentGrid: document.getElementById("recentGrid"),

  // 每日推荐页面
  refreshRecommendations: document.getElementById("refreshRecommendations"),
  dailyStats: document.getElementById("dailyStats"),
  dailyGrid: document.getElementById("dailyGrid"),

  // 音乐库页面
  addToLibrary: document.getElementById("addToLibrary"),
  scanLibrary: document.getElementById("scanLibrary"),
  sortLibrary: document.getElementById("sortLibrary"),
  libraryGrid: document.getElementById("libraryGrid"),
  libraryEmpty: document.getElementById("libraryEmpty"),
  libraryUploadButton: document.getElementById("libraryUploadButton"),

  // 上传页面
  uploadDropArea: document.getElementById("uploadDropArea"),
  selectFilesButton: document.getElementById("selectFilesButton"),
  uploadQueue: document.getElementById("uploadQueue"),
  clearQueue: document.getElementById("clearQueue"),
  uploadQueueList: document.getElementById("uploadQueueList"),
  startUploadButton: document.getElementById("startUploadButton"),

  // 喜欢页面
  favoritesGrid: document.getElementById("favoritesGrid"),
  favoritesEmpty: document.getElementById("favoritesEmpty"),

  // 设置页面 - 使用 getter 延迟获取，确保元素已存在
  get autoPlayToggle() {
    return document.getElementById("autoPlayToggle");
  },
  get highQualityToggle() {
    return document.getElementById("highQualityToggle");
  },
  get showLyricsToggle() {
    return document.getElementById("showLyricsToggle");
  },
  get playerLyricsToggleSetting() {
    return document.getElementById("playerLyricsToggleSetting");
  },

  // 音乐源管理
  musicSourceUrl: document.getElementById("musicSourceUrl"),
  importSourceBtn: document.getElementById("importSourceBtn"),
  importProgress: document.getElementById("importProgress"),
  sourceUploadArea: document.getElementById("sourceUploadArea"),
  sourceFileInput: document.getElementById("sourceFileInput"),
  musicSourceList: document.getElementById("musicSourceList"),

  // 播放器
  audioPlayer: document.getElementById("audioPlayer"),
  playerCover: document.getElementById("playerCover"),
  playerTitle: document.getElementById("playerTitle"),
  playerArtist: document.getElementById("playerArtist"),
  playerLikeBtn: document.getElementById("playerLikeBtn"),
  playerShuffleBtn: document.getElementById("playerShuffleBtn"),
  playerPrevBtn: document.getElementById("playerPrevBtn"),
  playerPlayBtn: document.getElementById("playerPlayBtn"),
  playerNextBtn: document.getElementById("playerNextBtn"),
  playerRepeatBtn: document.getElementById("playerRepeatBtn"),
  playerCurrentTime: document.getElementById("playerCurrentTime"),
  playerProgressBar: document.getElementById("playerProgressBar"),
  playerProgressFilled: document.getElementById("playerProgressFilled"),
  playerDuration: document.getElementById("playerDuration"),
  playerVolumeBtn: document.getElementById("playerVolumeBtn"),
  playerVolumeSlider: document.getElementById("playerVolumeSlider"),
  playerVolumeFilled: document.getElementById("playerVolumeFilled"),

  // 播放器歌词元素
  playerLyricsContainer: document.getElementById("playerLyricsContainer"),
  playerLyricsScroll: document.getElementById("playerLyricsScroll"),
  playerLyricsLine: document.getElementById("playerLyricsLine"),
  playerLyricsToggle: document.getElementById("playerLyricsToggle"),
  playerLyricsStatus: document.getElementById("playerLyricsStatus"),

  // 歌词面板
  lyricsPanel: document.getElementById("lyricsPanel"),
  lyricsContent: document.getElementById("lyricsContent"),
  lyricsCloseBtn: document.getElementById("lyricsCloseBtn"),

  // 文件输入
  fileInput: document.getElementById("fileInput"),

  // 新增元素
  networkStatus: document.getElementById("networkStatus"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  errorOverlay: document.getElementById("errorOverlay"),
  errorTitle: document.getElementById("errorTitle"),
  errorMessage: document.getElementById("errorMessage"),
  errorCloseBtn: document.getElementById("errorCloseBtn"),
  errorRetryBtn: document.getElementById("errorRetryBtn"),
  // 动态元素 - 使用getter实现延迟加载
  get retryFailedBtn() {
    return document.getElementById("retryFailedBtn");
  },
  get selectAllBtn() {
    return document.getElementById("selectAllBtn");
  },
  get backgroundPlaybackToggle() {
    return document.getElementById("backgroundPlaybackToggle");
  },
  discoverPage: document.getElementById("discoverPage"),
  historyPage: document.getElementById("historyPage"),
};

// 唯一音频实例 - 现在dom对象已定义
const audioPlayer = dom.audioPlayer;

if (!audioPlayer) {
  console.error("❌ 未找到 audioPlayer 元素，请检查 HTML");
}

// 在 script.js 的 dom 对象定义后添加验证
console.log("🔍 验证 DOM 元素...");
const missingElements = [];
for (const key of Object.keys(dom)) {
  const descriptor = Object.getOwnPropertyDescriptor(dom, key);
  // 跳过 getter 属性（动态元素）和 ws
  if (descriptor && !descriptor.get && key !== "ws") {
    const value = dom[key];
    if (value === null) {
      missingElements.push(key);
    }
  }
}
if (missingElements.length > 0) {
  console.warn("⚠️ 以下 DOM 元素未找到:", missingElements);
  // 不抛出错误，让应用继续
}

// 工具函数
// 缓存存储
const cacheStore = {
  data: new Map(),
  maxAge: 5 * 60 * 1000, // 5分钟过期时间

  set(key, value) {
    const timestamp = Date.now();
    this.data.set(key, { value, timestamp });
  },

  get(key) {
    const item = this.data.get(key);
    if (!item) return null;

    const isExpired = Date.now() - item.timestamp > this.maxAge;
    if (isExpired) {
      this.data.delete(key);
      return null;
    }

    return item.value;
  },

  delete(key) {
    this.data.delete(key);
  },

  clear() {
    this.data.clear();
  },
};

const utils = {
  // 缓存相关
  cache: cacheStore,

  // 生成缓存键
  getCacheKey(url, options = {}) {
    const keyOptions = { ...options };
    // 排除可能变化但不影响结果的选项
    delete keyOptions.headers;
    delete keyOptions.signal;
    return `${url}__${JSON.stringify(keyOptions)}`;
  },

  // 格式化时间
  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  },

  // 格式化文件大小
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },

  // 生成随机颜色
  getRandomColor() {
    const colors = [
      "#FF6B6B",
      "#4ECDC4",
      "#FFD166",
      "#06D6A0",
      "#118AB2",
      "#073B4C",
      "#EF476F",
      "#7209B7",
      "#3A86FF",
      "#FB5607",
      "#8338EC",
      "#FF006E",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  // 生成封面占位符
  createCoverPlaceholder(text) {
    const color = this.getRandomColor();
    const firstChar = text ? text.charAt(0).toUpperCase() : "M";
    return `<div style="width: 100%; height: 100%; background-color: ${color}; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 1.5rem;">${firstChar}</div>`;
  },

  // 检测音频格式是否支持
  isAudioFormatSupported(url) {
    try {
      if (!url) return true; // 如果没有URL，让浏览器尝试（可能是本地文件）

      // 获取扩展名
      const urlObj = new URL(url, window.location.origin);
      const pathname = urlObj.pathname;
      const extension = pathname.split(".").pop().toLowerCase();

      // 支持更多的音频格式
      const supportedFormats = [
        "mp3",
        "wav",
        "ogg",
        "m4a",
        "aac",
        "flac",
        "mpeg",
        "mp4",
        "webm",
        "opus",
        "wma",
        "aiff",
      ];

      // 如果没有扩展名，假设支持（让浏览器尝试）
      if (!extension || extension === pathname) {
        console.log("URL没有扩展名，让浏览器尝试播放");
        return true;
      }

      // 放宽检查：如果格式在支持列表中，返回true；否则让浏览器尝试
      if (supportedFormats.includes(extension)) {
        return true;
      } else {
        console.warn(`未知音频扩展名: .${extension}，让浏览器尝试`);
        return true; // 改为返回true，让浏览器决定
      }
    } catch (error) {
      console.error("检测音频格式失败，假设支持:", error);
      return true; // 出错时假设支持，让浏览器决定
    }
  },

  // 检测浏览器支持的音频格式
  getSupportedAudioFormats() {
    const audio = document.createElement("audio");
    const formats = [
      { type: "audio/mpeg", ext: "mp3" },
      { type: "audio/wav", ext: "wav" },
      { type: "audio/ogg", ext: "ogg" },
      { type: "audio/mp4", ext: "m4a" },
      { type: "audio/aac", ext: "aac" },
      { type: "audio/flac", ext: "flac" },
      { type: "audio/webm", ext: "webm" },
    ];

    return formats.filter((format) => audio.canPlayType(format.type));
  },

  // 获取音频文件的MIME类型
  getAudioMimeType(url) {
    try {
      const extension = url.split(".").pop().toLowerCase();
      return CONFIG.AUDIO_MIME_TYPES[extension] || "audio/mpeg";
    } catch (error) {
      return "audio/mpeg";
    }
  },

  // 修复URL编码问题
  fixAudioUrl(url) {
    if (!url || typeof url !== "string") {
      console.error("fixAudioUrl: URL为空或非字符串:", url);
      return "";
    }

    try {
      // 移除多余空格
      url = url.trim();

      // 如果已经是完整URL，直接返回
      if (
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      ) {
        console.log("fixAudioUrl: 完整URL，直接返回:", url);
        return url;
      }

      // 如果是相对路径，确保以 / 开头
      if (!url.startsWith("/")) {
        console.log("fixAudioUrl: 添加前导斜杠:", url);
        url = "/" + url;
      }

      // 对特殊字符进行编码
      const segments = url.split("/").map((segment) => {
        // 跳过空段
        if (!segment) return "";
        // 编码但保留斜杠
        return encodeURIComponent(segment).replace(/%2F/g, "/");
      });

      const result = segments.join("/");
      console.log("fixAudioUrl: 修复后URL:", result);
      return result;
    } catch (error) {
      console.error("修复音频URL失败，返回原URL:", error, url);
      return url;
    }
  },

  // 显示音频格式错误提示
  showAudioFormatError(filename) {
    const extension = filename
      ? filename.split(".").pop().toLowerCase()
      : "未知";
    const message = `不支持的文件格式: .${extension}。支持格式: ${CONFIG.SUPPORTED_AUDIO_FORMATS.join(", ")}`;
    this.showMessage(message, "error");
  },

  // 显示消息
  showMessage(message, type = "info") {
    try {
      const backgroundColor =
        {
          success: "#1db954",
          error: "#ff6b6b",
          warning: "#ffd166",
          info: "#535353",
        }[type] || "#535353";

      Toastify({
        text: message,
        duration: 3000,
        gravity: "top",
        position: "right",
        stopOnFocus: true,
        style: {
          background: backgroundColor,
          borderRadius: "8px",
          fontFamily: "inherit",
        },
      }).showToast();
    } catch (error) {
      console.error("显示消息失败:", error);
    }
  },

  // 防抖函数
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // 节流函数
  throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  // 带重试的fetch，支持缓存
  async fetchWithRetry(
    url,
    options = {},
    maxRetries = CONFIG.MAX_RETRIES,
    delay = CONFIG.RETRY_DELAY,
    enableCache = true,
  ) {
    // 检查缓存
    if (enableCache) {
      const cacheKey = this.getCacheKey(url, options);
      const cachedData = this.cache.get(cacheKey);
      if (cachedData) {
        console.log("🗄️ 使用缓存数据:", url);
        return cachedData;
      }
    }

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // 存储到缓存
        if (enableCache) {
          const cacheKey = this.getCacheKey(url, options);
          this.cache.set(cacheKey, data);
        }

        return data;
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries) {
          console.warn(`请求失败，正在重试 (${attempt}/${maxRetries})`, error);
          await this.sleep(delay * Math.pow(2, attempt - 1)); // 指数退避
        }
      }
    }

    throw lastError;
  },

  // 睡眠函数
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  // 显示错误弹窗
  showError(title, message) {
    try {
      if (!dom.errorOverlay || !dom.errorTitle || !dom.errorMessage) return;

      dom.errorTitle.textContent = title || "发生错误";
      dom.errorMessage.textContent = message || "发生了未知错误";
      dom.errorOverlay.style.display = "flex";

      // 移除旧的事件监听器
      const newCloseBtn = dom.errorCloseBtn.cloneNode(true);
      const newRetryBtn = dom.errorRetryBtn.cloneNode(true);

      dom.errorCloseBtn.parentNode.replaceChild(newCloseBtn, dom.errorCloseBtn);
      dom.errorRetryBtn.parentNode.replaceChild(newRetryBtn, dom.errorRetryBtn);

      // 更新引用
      dom.errorCloseBtn = newCloseBtn;
      dom.errorRetryBtn = newRetryBtn;

      // 添加新的事件监听器
      dom.errorCloseBtn.addEventListener("click", () => {
        dom.errorOverlay.style.display = "none";
      });

      dom.errorRetryBtn.addEventListener("click", () => {
        dom.errorOverlay.style.display = "none";
        window.location.reload();
      });
    } catch (error) {
      console.error("显示错误弹窗失败:", error);
    }
  },

  // 生成唯一ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },

  // 检查浏览器是否支持后台播放
  supportsBackgroundPlayback() {
    const supportsAudioContext =
      typeof AudioContext !== "undefined" ||
      typeof webkitAudioContext !== "undefined";
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS && isSafari) {
      return {
        supported: false,
        reason: "iOS Safari需要用户手势才能播放音频",
        requiresUserGesture: true,
        isMobile: true,
        isIOS: true,
        isSafari: true,
      };
    }

    return {
      supported: supportsAudioContext && CONFIG.BACKGROUND_PLAYBACK,
      isMobile: isMobile,
      isIOS: isIOS,
      isSafari: isSafari,
      requiresUserGesture: false,
    };
  },

  // 初始化音频上下文
  async initializeAudioContext() {
    try {
      // 如果已存在且未关闭，先关闭
      if (state.audioContext && state.audioContext.state !== "closed") {
        try {
          await state.audioContext.close();
        } catch (closeError) {
          console.warn("关闭旧音频上下文失败:", closeError);
        }
      }

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn("浏览器不支持 Web Audio API");
        return null;
      }

      state.audioContext = new AudioContextClass();
      console.log("音频上下文已创建，状态:", state.audioContext.state);

      // 安全地添加状态变化监听
      try {
        state.audioContext.addEventListener("statechange", () => {
          try {
            console.log("音频上下文状态变化:", state.audioContext.state);
            state.audioContextSuspended =
              state.audioContext.state === "suspended";

            if (state.audioContext.state === "suspended" && state.isPlaying) {
              console.log("音频上下文被挂起，尝试恢复...");
              this.resumeAudioContext();
            }
          } catch (e) {
            console.error("处理音频上下文状态变化失败:", e);
          }
        });
      } catch (listenerError) {
        console.error("添加音频上下文事件监听失败:", listenerError);
      }

      return state.audioContext;
    } catch (error) {
      console.error("初始化音频上下文失败:", error);
      state.audioContext = null;
      return null;
    }
  },

  // 恢复音频上下文
  async resumeAudioContext() {
    if (state.audioContextResuming || !state.audioContext) {
      console.warn("没有音频上下文需要恢复");
      return false;
    }

    try {
      state.audioContextResuming = true;
      const supportInfo = this.supportsBackgroundPlayback();
      if (supportInfo.requiresUserGesture && !state.pageVisible) {
        console.log("需要用户手势来恢复音频上下文");
        return false;
      }

      if (state.audioContext.state === "suspended") {
        await state.audioContext.resume();
        console.log("音频上下文已恢复");
        return true;
      }

      return state.audioContext.state === "running";
    } catch (error) {
      console.error("恢复音频上下文失败:", error);
      return false;
    } finally {
      state.audioContextResuming = false;
    }
  },

  // 创建Web Audio API音频源
  createAudioSource(audioElement) {
    if (!state.audioContext || state.audioContext.state === "closed") {
      console.error("音频上下文不可用");
      return null;
    }

    try {
      // 如果已存在音频源，先断开连接
      if (state.audioSource) {
        try {
          state.audioSource.disconnect();
        } catch (disconnectError) {
          console.warn("断开旧音频源失败:", disconnectError);
        }
      }

      const source = state.audioContext.createMediaElementSource(audioElement);
      source.connect(state.audioContext.destination);
      state.audioSource = source;
      console.log("Web Audio源已创建");
      return source;
    } catch (error) {
      console.error("创建音频源失败:", error);
      return null;
    }
  },

  // 请求唤醒锁（防止设备休眠）
  async requestWakeLock() {
    try {
      if (!CONFIG.WAKE_LOCK_SUPPORT) {
        console.log("浏览器不支持唤醒锁API");
        return null;
      }

      if (!state.isPlaying || !state.pageVisible) {
        return null;
      }

      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        console.log("唤醒锁已释放");
        state.wakeLock = null;
      });

      console.log("唤醒锁已获取");
      return state.wakeLock;
    } catch (error) {
      console.error("请求唤醒锁失败:", error);
      return null;
    }
  },

  // 释放唤醒锁
  async releaseWakeLock() {
    if (state.wakeLock) {
      try {
        await state.wakeLock.release();
        state.wakeLock = null;
        console.log("唤醒锁已释放");
      } catch (error) {
        console.error("释放唤醒锁失败:", error);
      }
    }
  },

  // 处理页面可见性变化
  handleVisibilityChange() {
    state.pageVisible = !document.hidden;
    if (state.pageVisible) {
      this.onPageVisible();
    } else {
      this.onPageHidden();
    }
  },

  // 页面变为可见时的处理
  onPageVisible() {
    state.lastActiveTime = Date.now();
    if (state.audioContext && state.audioContext.state === "suspended") {
      this.resumeAudioContext();
    }
    if (state.isPlaying) {
      this.requestWakeLock();
    }
    if (window.ui && window.ui.updatePlayButton) {
      ui.updatePlayButton();
    }
  },

  // 页面变为隐藏时的处理
  onPageHidden() {
    state.lastActiveTime = Date.now();
    if (state.audioContext && state.audioContext.state === "suspended") {
      setTimeout(() => {
        if (!state.pageVisible && state.isPlaying) {
          this.resumeAudioContext();
        }
      }, 1000);
    }
  },

  // 检查是否需要挂起音频上下文（长时间不活动）
  checkAudioContextTimeout() {
    if (!state.audioContext || !state.backgroundPlaybackEnabled) return;
    const now = Date.now();
    const inactiveTime = now - state.lastActiveTime;
    if (
      !state.pageVisible &&
      inactiveTime > CONFIG.SUSPEND_TIMEOUT &&
      state.audioContext.state === "running"
    ) {
      console.log("长时间不活动，挂起音频上下文");
      state.audioContext.suspend();
    }
  },

  // 初始化后台播放
  async initializeBackgroundPlayback() {
    console.log("🎵 开始初始化后台播放功能...");

    // 外层 try-catch，捕获所有可能的错误
    try {
      const supportInfo = this.supportsBackgroundPlayback();
      console.log("浏览器支持信息:", supportInfo);

      // 检查浏览器支持情况
      if (!supportInfo.supported) {
        console.warn(
          "⚠️ 浏览器不支持后台播放:",
          supportInfo.reason || "未知原因",
        );
        state.backgroundPlaybackEnabled = false;

        // 安全地显示用户提示（不会抛出错误）
        if (supportInfo.requiresUserGesture && !state.pageVisible) {
          try {
            this.showUserGestureNotification();
          } catch (notifyError) {
            console.warn("显示用户提示失败:", notifyError);
          }
        }

        console.log("✅ 后台播放初始化完成（已禁用）");
        return false;
      }

      // 初始化音频上下文
      let audioContext;
      try {
        audioContext = await this.initializeAudioContext();
      } catch (initError) {
        console.error("音频上下文初始化失败:", initError);
        audioContext = null;
      }

      if (!audioContext) {
        console.warn("⚠️ 无法创建音频上下文，后台播放不可用");
        state.backgroundPlaybackEnabled = false;
        return false;
      }

      // 安全地添加事件监听器
      try {
        document.addEventListener("visibilitychange", () => {
          try {
            this.handleVisibilityChange();
          } catch (e) {
            console.error("处理可见性变化失败:", e);
          }
        });

        window.addEventListener("focus", () => {
          try {
            state.tabActive = true;
            this.onPageVisible();
          } catch (e) {
            console.error("处理窗口焦点事件失败:", e);
          }
        });

        window.addEventListener("blur", () => {
          try {
            state.tabActive = false;
          } catch (e) {
            console.error("处理窗口失焦事件失败:", e);
          }
        });

        window.addEventListener("beforeunload", () => {
          try {
            this.cleanupBackgroundPlayback();
          } catch (e) {
            console.error("清理后台播放资源失败:", e);
          }
        });
      } catch (eventError) {
        console.error("添加事件监听器失败:", eventError);
      }

      // 启动定时检查
      try {
        setInterval(() => {
          try {
            this.checkAudioContextTimeout();
          } catch (e) {
            console.error("检查音频上下文超时失败:", e);
          }
        }, 60000);
      } catch (intervalError) {
        console.error("设置定时器失败:", intervalError);
      }

      console.log("✅ 后台播放初始化成功");
      return true;
    } catch (unexpectedError) {
      // 捕获所有未预见的错误
      console.error("❌ 后台播放初始化遇到致命错误:", unexpectedError);
      state.backgroundPlaybackEnabled = false;
      state.audioContext = null;

      // 不要抛出错误，让应用继续运行
      console.log("✅ 后台播放初始化完成（回退模式）");
      return false;
    }
  },

  // 显示用户手势通知（针对iOS Safari等）
  showUserGestureNotification() {
    try {
      // 延迟显示，确保 DOM 就绪
      setTimeout(() => {
        try {
          const notification = document.createElement("div");
          notification.id = "userGestureNotification";
          notification.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: var(--bg-card);
                        border: 2px solid var(--primary-color);
                        border-radius: var(--radius-lg);
                        padding: 20px;
                        max-width: 300px;
                        z-index: 10000;
                        box-shadow: var(--shadow-lg);
                        animation: slideIn 0.3s ease;
                        backdrop-filter: blur(10px);
                    `;
          notification.innerHTML = `
                        <h3 style="margin-bottom: 10px; color: var(--primary-color);">
                            <i class="fas fa-music"></i> 播放提示
                        </h3>
                        <p style="margin-bottom: 15px; color: var(--text-secondary);">
                            在iOS设备上，需要先点击播放按钮才能启用后台播放功能。
                        </p>
                        <p style="font-size: 0.9rem; color: var(--text-tertiary);">
                            提示：点击任意播放按钮开始音乐播放。
                        </p>
                    `;

          // 检查 body 是否存在
          if (document.body) {
            document.body.appendChild(notification);

            // 5秒后自动移除
            setTimeout(() => {
              if (notification.parentNode) {
                notification.style.animation = "slideOut 0.3s ease";
                setTimeout(() => {
                  if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                  }
                }, 300);
              }
            }, 5000);

            // 点击关闭
            notification.addEventListener("click", () => {
              if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
              }
            });
          }
        } catch (createError) {
          console.warn("创建用户提示元素失败:", createError);
        }
      }, 1000);
    } catch (error) {
      console.warn("显示用户手势通知失败:", error);
    }
  },

  // 清理后台播放资源
  cleanupBackgroundPlayback() {
    this.releaseWakeLock();
    if (state.audioContext && state.audioContext.state !== "closed") {
      state.audioContext.close();
      console.log("音频上下文已关闭");
    }
    if (state.audioSource) {
      state.audioSource.disconnect();
      state.audioSource = null;
    }
  },

  // 开始播放音乐（使用Web Audio API）
  async startPlaybackWithWebAudio(audioElement) {
    if (!state.backgroundPlaybackEnabled || !state.audioContext) {
      return audioElement.play();
    }

    try {
      if (state.audioContext.state === "suspended") {
        await this.resumeAudioContext();
      }
      if (!state.audioSource) {
        this.createAudioSource(audioElement);
      }
      const playPromise = audioElement.play();
      if (playPromise) {
        playPromise
          .then(() => this.requestWakeLock())
          .catch((error) => {
            console.error("播放失败:", error);
            if (error.name === "NotAllowedError") {
              return audioElement.play();
            }
          });
      }
      return playPromise;
    } catch (error) {
      console.error("Web Audio播放失败:", error);
      return audioElement.play();
    }
  },
};

// 错误处理和恢复机制
const errorHandler = {
  errorQueue: [],
  maxQueueSize: 50,
  recoveryStrategies: new Map(),
  criticalErrors: new Set(['DATABASE_ERROR', 'AUTH_ERROR', 'NETWORK_ERROR']),
  
  // 注册错误恢复策略
  registerRecoveryStrategy(errorType, recoveryFunction) {
    this.recoveryStrategies.set(errorType, recoveryFunction);
  },
  
  // 记录错误
  logError(error, context = {}) {
    const errorInfo = {
      timestamp: Date.now(),
      message: error.message || error.toString(),
      stack: error.stack,
      context,
      recovered: false
    };
    
    this.errorQueue.push(errorInfo);
    
    // 保持队列大小
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
    
    console.error('错误已记录:', errorInfo);
    
    // 尝试自动恢复
    this.tryRecovery(errorInfo);
    
    return errorInfo;
  },
  
  // 尝试错误恢复
  async tryRecovery(errorInfo) {
    const errorType = this.getErrorType(errorInfo);
    
    // 获取对应的恢复策略
    const recoveryFunction = this.recoveryStrategies.get(errorType);
    
    if (recoveryFunction) {
      try {
        console.log(`尝试恢复错误: ${errorType}`);
        const recovered = await recoveryFunction(errorInfo);
        if (recovered) {
          errorInfo.recovered = true;
          console.log(`错误已成功恢复: ${errorType}`);
          utils.showMessage(`系统已自动恢复: ${errorType}`, 'success');
        }
      } catch (recoveryError) {
        console.error(`错误恢复失败: ${recoveryError}`);
      }
    } else {
      // 对于没有恢复策略的错误，使用默认处理
      this.defaultErrorHandling(errorInfo, errorType);
    }
  },
  
  // 确定错误类型
  getErrorType(errorInfo) {
    const message = errorInfo.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch')) {
      return 'NETWORK_ERROR';
    } else if (message.includes('database') || message.includes('sqlite')) {
      return 'DATABASE_ERROR';
    } else if (message.includes('auth') || message.includes('unauthorized')) {
      return 'AUTH_ERROR';
    } else if (message.includes('parse') || message.includes('json')) {
      return 'PARSE_ERROR';
    } else if (message.includes('cors') || message.includes('cross-origin')) {
      return 'CORS_ERROR';
    } else if (message.includes('timeout')) {
      return 'TIMEOUT_ERROR';
    }
    
    return 'UNKNOWN_ERROR';
  },
  
  // 默认错误处理
  defaultErrorHandling(errorInfo, errorType) {
    if (this.criticalErrors.has(errorType)) {
      utils.showMessage(`发生了严重错误: ${errorType}`, 'error');
      if (errorType === 'NETWORK_ERROR') {
        utils.showMessage('请检查您的网络连接', 'warning');
      }
    } else {
      utils.showMessage(`发生了错误: ${errorType}`, 'warning');
    }
  },
  
  // 获取错误报告
  getErrorReport() {
    return this.errorQueue.slice();
  },
  
  // 清除错误记录
  clearErrors() {
    this.errorQueue = [];
  }
};

// 网络状态管理
const networkManager = {
  isOnline: navigator.onLine,
  retryCount: 0,
  maxRetryCount: 5,

  init() {
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.retryCount = 0; // 重置重试计数
      this.showNetworkStatus("网络已恢复", "online");
      utils.showMessage("网络连接已恢复", "success");
      
      // 网络恢复时尝试重新连接WebSocket
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        wsManager.connect();
      }
      
      // 重新加载音乐数据
      setTimeout(() => {
        musicManager.loadMusicData();
      }, 1000);
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.showNetworkStatus("网络已断开", "offline");
      utils.showMessage("网络连接已断开，部分功能可能无法使用", "warning");
      
      // 记录错误
      errorHandler.logError(new Error('网络连接已断开'), {
        type: 'NETWORK_DISCONNECT',
        isOnline: false
      });
    });

    if (!this.isOnline) {
      this.showNetworkStatus("网络已断开", "offline");
    }
    
    // 定期检查网络状态
    setInterval(this.checkNetworkHealth.bind(this), 30000);
  },
  
  // 检查网络健康状况
  async checkNetworkHealth() {
    if (!this.isOnline) return;
    
    try {
      // 使用fetch请求一个小的API来检查网络状态
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${window.location.origin}/api/health`, {
        signal: controller.signal,
        cache: 'no-cache'
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      // 网络健康，重置重试计数
      this.retryCount = 0;
    } catch (error) {
      this.retryCount++;
      console.warn(`网络健康检查失败 (${this.retryCount}/${this.maxRetryCount}):`, error.message);
      
      if (this.retryCount >= this.maxRetryCount) {
        errorHandler.logError(new Error('网络连接不稳定'), {
          type: 'NETWORK_UNSTABLE',
          retryCount: this.retryCount
        });
      }
    }
  },

  showNetworkStatus(message, type) {
    try {
      if (!dom.networkStatus) return;
      dom.networkStatus.textContent = message;
      dom.networkStatus.className = `network-status ${type}`;
      dom.networkStatus.style.display = "block";
      
      // 不同类型的消息显示时间不同
      let displayTime = 3000;
      if (type === 'error' || type === 'connecting') {
        displayTime = 5000;
      } else if (type === 'offline') {
        displayTime = 10000;
      }
      
      setTimeout(() => {
        dom.networkStatus.style.display = "none";
      }, displayTime);
    } catch (error) {
      console.error("显示网络状态失败:", error);
    }
  }
};

// 加载状态管理
const loadingManager = {
  show(message = "正在加载...") {
    try {
      if (!dom.loadingOverlay || !dom.loadingText) return;
      dom.loadingText.textContent = message;
      dom.loadingOverlay.style.display = "flex";
    } catch (error) {
      console.error("显示加载状态失败:", error);
    }
  },

  hide() {
    try {
      if (!dom.loadingOverlay) return;
      dom.loadingOverlay.style.display = "none";
    } catch (error) {
      console.error("隐藏加载状态失败:", error);
    }
  },
};

// WebSocket管理器
const wsManager = {
  ws: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  heartbeatInterval: null,
  isConnecting: false,
  connectionState: 'disconnected', // disconnected, connecting, connected, error
  lastError: null,
  
  // 添加连接状态监听器
  listeners: [],

  init() {
    // 延迟初始化，确保页面完全加载
    setTimeout(() => {
      if (navigator.onLine) {
        this.connect();
      } else {
        console.log("浏览器离线，WebSocket连接已延迟");
        this.setState('offline');
        // 监听网络状态变化
        window.addEventListener('online', () => {
          console.log("网络已恢复，尝试连接WebSocket");
          this.connect();
        });
        window.addEventListener('offline', () => {
          console.log("网络已断开");
          this.setState('offline');
          if (this.ws) {
            this.ws.close(1000, '网络断开');
          }
        });
      }
    }, 1000);
  },
  
  // 设置连接状态并通知监听器
  setState(newState, error = null) {
    const oldState = this.connectionState;
    this.connectionState = newState;
    this.lastError = error;
    
    if (oldState !== newState) {
      console.log(`WebSocket状态变化: ${oldState} -> ${newState}`);
      if (error) console.error(`错误详情:`, error);
      
      // 通知所有监听器
      this.listeners.forEach(callback => {
        try {
          callback(newState, oldState, error);
        } catch (err) {
          console.error("状态监听器回调出错:", err);
        }
      });
      
      // 根据状态更新UI
      if (newState === 'connected') {
        networkManager.showNetworkStatus("服务器连接成功", "online");
      } else if (newState === 'connecting') {
        networkManager.showNetworkStatus("正在连接服务器...", "connecting");
      } else if (newState === 'disconnected') {
        networkManager.showNetworkStatus("服务器连接断开", "offline");
      } else if (newState === 'error') {
        networkManager.showNetworkStatus("连接错误", "error");
      } else if (newState === 'offline') {
        networkManager.showNetworkStatus("网络不可用", "offline");
      }
    }
  },
  
  // 添加状态变化监听器
  addStateListener(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  },

  connect() {
    if (this.isConnecting) {
      console.log("WebSocket正在连接中，忽略重复请求");
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("WebSocket已连接");
      this.setState('connected');
      return;
    }

    if (!navigator.onLine) {
      console.log("浏览器离线，跳过WebSocket连接");
      this.setState('offline');
      return;
    }

    try {
      // 清理旧连接
      if (this.ws) {
        if (this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        } else {
          this.ws.close(1000, "重新连接");
        }
      }

      this.isConnecting = true;
      this.setState('connecting');

      // 添加连接超时
      const connectionTimeout = setTimeout(() => {
        if (this.isConnecting && this.ws) {
          this.ws.close(1006, "连接超时");
        }
      }, 15000);

      this.ws = new WebSocket(CONFIG.WEBSOCKET_URL);
      this.setupWebSocketEvents(connectionTimeout);
    } catch (error) {
      this.isConnecting = false;
      console.error("WebSocket初始化失败:", error);
      this.setState('error', error);
      this.scheduleReconnect();
    }
  },

  setupWebSocketEvents(connectionTimeout) {
    if (!this.ws) return;

    this.ws.onopen = () => {
      clearTimeout(connectionTimeout);
      this.isConnecting = false;
      console.log("WebSocket连接成功");
      this.reconnectAttempts = 0;
      state.ws = this.ws;
      this.setState('connected');
      this.startHeartbeat();
      this.send({ type: "subscribe", channel: "all" });
      this.send({ type: "get_library" });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error("WebSocket消息解析失败:", error);
      }
    };

    this.ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      this.isConnecting = false;
      
      console.log(`WebSocket连接关闭: ${event.code} - ${event.reason || '无原因'}`);
      state.ws = null;
      this.stopHeartbeat();
      
      // 根据关闭代码判断是否需要重连
      const shouldReconnect = event.code !== 1000 && // 不是正常关闭
                            event.code !== 1001 && // 不是服务器关闭
                            navigator.onLine;       // 网络在线
      
      if (shouldReconnect) {
        this.setState('disconnected');
        this.scheduleReconnect();
      } else {
        this.setState(event.code === 1000 ? 'disconnected' : 'offline');
      }
    };

    this.ws.onerror = (error) => {
      clearTimeout(connectionTimeout);
      this.isConnecting = false;
      console.error("WebSocket错误:", error);
      this.setState('error', error);
      
      // 在某些浏览器中，onerror后还会触发onclose，所以这里只记录错误
      // 不调用scheduleReconnect()，让onclose处理重连逻辑
    };
  },

  handleMessage(data) {
    switch (data.type) {
      case "music_uploaded":
        utils.showMessage(
          `新音乐已上传: ${data.data.title} - ${data.data.artist}`,
          "success",
        );
        setTimeout(() => musicManager.loadMusicData(), 2000);
        break;
      case "music_updated":
        utils.showMessage(`音乐信息已更新: ${data.data.title}`, "info");
        break;
      case "music_deleted":
        utils.showMessage(`音乐已删除: ${data.data.title}`, "warning");
        if (state.currentTrack && state.currentTrack.id === data.data.songId) {
          player.pause();
          state.currentTrack = null;
          ui.updatePlayerInfo();
        }
        setTimeout(() => musicManager.loadMusicData(), 2000);
        break;
      case "library_cleaned":
        utils.showMessage(`音乐库已清理: ${data.data.message}`, "info");
        setTimeout(() => musicManager.loadMusicData(), 2000);
        break;
      case "system_error":
        console.error("服务器错误:", data.data);
        utils.showMessage(`服务器错误: ${data.data.message}`, "error");
        break;
      case "welcome":
        console.log("WebSocket欢迎消息:", data.message);
        break;
      case "pong":
        break;
      case "subscription_confirmed":
        console.log(`订阅确认: ${data.channel}`);
        break;
      case "server_status":
        console.log("服务器状态:", data.data);
        break;
      case "library_data":
        console.log("接收到音乐库数据，数量:", data.data.songs.length);
        // 更新音乐库数据
        state.library = Array.isArray(data.data.songs) ? data.data.songs : [];
        // 重建索引
        state.songIndexById = new Map();
        state.library.forEach((song) => {
          if (song && song.id) {
            state.songIndexById.set(song.id, song);
          }
        });
        // 更新推荐
        state.featuredTracks = state.library.slice(0, Math.min(8, state.library.length));
        // 更新UI
        ui.updateLibraryStats();
        ui.updateBadges();
        ui.renderPage(state.currentPage);
        break;
      case "lyrics_data":
        console.log("接收到歌词数据，歌曲ID:", data.data.songId);
        if (state.currentTrack && state.currentTrack.id === data.data.songId) {
          state.currentLyrics = ui.parseLyrics(data.data.lyrics);
          if (state.lyricsPanelOpen) {
            ui.displayLyrics();
          }
        }
        break;
      case "music_playing":
        console.log(`用户 ${data.from} 正在播放:`, data.data);
        break;
      case "user_online":
        console.log(
          `用户上线: ${data.data.clientId}, 当前在线: ${data.data.totalOnline}`,
        );
        break;
      case "user_offline":
        console.log(`用户下线: ${data.data.clientId}`);
        break;
      case "chat_message":
        console.log("聊天消息:", data.data);
        if (data.data.type === "chat") {
          const notification = `${data.data.clientId}: ${data.data.text}`;
          utils.showMessage(notification, "info");
        }
        break;
      case "user_typing":
        console.log(`用户 ${data.data.clientId} 正在输入:`, data.data.isTyping);
        break;
      default:
        console.log("未处理的WebSocket消息类型:", data.type, data);
        break;
    }
  },

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (error) {
        console.error("发送WebSocket消息失败:", error);
      }
    }
  },

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "ping" });
      }
    }, 30000);
  },

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  },

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`已达到最大重连次数 (${this.maxReconnectAttempts})，停止重连`);
      this.setState('error', new Error(`已达到最大重连次数 (${this.maxReconnectAttempts})`));
      return;
    }

    this.reconnectAttempts++;
    // 使用指数退避算法，但有最大延迟
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(
      `将在 ${delay}ms 后尝试重连 (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      // 检查是否仍然需要重连
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        if (navigator.onLine) {
          this.connect();
        } else {
          console.log("检测到离线，取消本次重连");
          this.setState('offline');
        }
      }
    }, delay);
  },

  close() {
    // 清理重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopHeartbeat();
    this.isConnecting = false;
    
    if (this.ws) {
      this.ws.close(1000, "正常关闭");
      this.ws = null;
      state.ws = null;
    }
    
    this.setState('disconnected');
  },

  sendPlayEvent(songId, time = 0) {
    this.send({
      type: "music_play",
      data: { songId, time, timestamp: Date.now() },
    });
  },

  sendPauseEvent(songId) {
    this.send({
      type: "music_pause",
      data: { songId, timestamp: Date.now() },
    });
  },

  sendSeekEvent(songId, time) {
    this.send({
      type: "music_seek",
      data: { songId, time, timestamp: Date.now() },
    });
  },

  sendLikeEvent(songId) {
    this.send({
      type: "music_like",
      data: { songId, timestamp: Date.now() },
    });
  },

  requestLyrics(songId) {
    this.send({ type: "request_lyrics", data: { songId } });
  },
};

// API函数
const api = {
  // 获取音乐库
  async getLibrary() {
    try {
      const cacheKey = "musicLibrary";
      const cached = this.getFromCache(cacheKey);
      if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        console.log("使用缓存的音乐库数据");
        return cached.data;
      }

      const data = await utils.fetchWithRetry(`${CONFIG.API_BASE_URL}/music`);

      // 修复：强制类型检查，确保返回数组
      const songs = Array.isArray(data.songs) ? data.songs : [];

      this.saveToCache(cacheKey, songs);
      return songs;
    } catch (error) {
      // 记录错误
      errorHandler.logError(error, {
        type: 'API_ERROR',
        apiCall: 'getLibrary'
      });
      
      console.error("获取音乐库失败:", error);
      const cached = this.getFromCache("musicLibrary");

      if (cached) {
        console.log("使用缓存的音乐库数据作为后备");
        return cached.data;
      }
      // throw error;

      // 修复：出错时返回空数组而不是 undefined
      return [];
    }
  },

  // 获取每日推荐
  async getDailyRecommendations() {
    try {
      const data = await utils.fetchWithRetry(
        `${CONFIG.API_BASE_URL}/recommendations/daily`,
      );
      return data.recommendations || [];
    } catch (error) {
      // 记录错误
      errorHandler.logError(error, {
        type: 'API_ERROR',
        apiCall: 'getDailyRecommendations'
      });
      
      console.error("获取每日推荐失败:", error);
      return [];
    }
  },

  // 获取统计信息
  async getStats() {
    try {
      const data = await utils.fetchWithRetry(`${CONFIG.API_BASE_URL}/stats`);
      return data;
    } catch (error) {
      console.error("获取统计信息失败:", error);
      return null;
    }
  },

  // 上传文件
  async uploadFile(file) {
    const formData = new FormData();
    formData.append("music", file);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      const response = await fetch(`${CONFIG.API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "上传失败" }));
        throw new Error(error.error || "上传失败");
      }

      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("上传超时，请重试");
      }
      throw error;
    }
  },

  // 重新扫描音乐库
  async rescanLibrary() {
    try {
      // utils.fetchWithRetry 已经解析了 JSON 并返回数据，不是 Response 对象
      const data = await utils.fetchWithRetry(
        `${CONFIG.API_BASE_URL}/rescan`,
        { method: "POST" },
        CONFIG.MAX_RETRIES,
        CONFIG.RETRY_DELAY,
        false,
      );
      return data;
    } catch (error) {
      console.error("扫描失败:", error);
      throw new Error("扫描失败: " + error.message);
    }
  },

  // 获取歌词
  async getLyrics(songId) {
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/lyrics/${songId}`);
      if (response.ok) {
        const data = await response.json();
        return data.lyrics || "";
      }
      return "";
    } catch (error) {
      console.error("获取歌词失败:", error);
      return "";
    }
  },

  // 搜索音乐
  async searchMusic(query) {
    try {
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/search?q=${encodeURIComponent(query)}`,
      );
      if (response.ok) {
        const data = await response.json();
        return data.results || [];
      }
      return [];
    } catch (error) {
      console.error("搜索失败:", error);
      return [];
    }
  },

  // 缓存管理
  getFromCache(key) {
    try {
      const cached = localStorage.getItem(`cache_${key}`);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      console.error("读取缓存失败:", error);
    }
    return null;
  },

  saveToCache(key, data) {
    try {
      localStorage.setItem(
        `cache_${key}`,
        JSON.stringify({
          data: data,
          timestamp: Date.now(),
        }),
      );
    } catch (error) {
      console.error("保存缓存失败:", error);
    }
  },

  clearCache() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith("cache_")) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error("清理缓存失败:", error);
    }
  },
};

// 音乐管理
const musicManager = {
  // 加载音乐数据
  // 替换 musicManager.loadMusicData 方法
  async loadMusicData() {
    try {
      console.log("📦 开始加载音乐库...");
      loadingManager.show("正在加载音乐库...");

      // 并行请求
      const [libraryResult, recommendationsResult, statsResult] =
        await Promise.allSettled([
          api.getLibrary(),
          api.getDailyRecommendations(),
          api.getStats(),
        ]);

      // 修复：简化赋值逻辑，因为 API 保证返回数组
      // 安全处理结果 - 确保总是返回数组
      state.library =
        libraryResult.status === "fulfilled" &&
        Array.isArray(libraryResult.value)
          ? libraryResult.value
          : [];

      state.dailyRecommendations =
        recommendationsResult.status === "fulfilled" &&
        Array.isArray(recommendationsResult.value)
          ? recommendationsResult.value
          : [];

      state.stats =
        statsResult.status === "fulfilled" ? statsResult.value : null;

      // 重建索引
      state.songIndexById = new Map();
      state.library.forEach((song) => {
        if (song && song.id) {
          state.songIndexById.set(song.id, song);
        }
      });

      // 重新加载本地数据（确保使用最新的 library）
      this.loadLocalData();

      // 生成推荐（限制数量）
      state.featuredTracks = state.library.slice(
        0,
        Math.min(8, state.library.length),
      );

      // 更新 UI
      ui.updateLibraryStats();
      ui.updateBadges();
      ui.renderPage(state.currentPage);

      loadingManager.hide();

      if (state.library.length > 0) {
        utils.showMessage(`已加载 ${state.library.length} 首音乐`, "success");
      } else {
        utils.showMessage("音乐库为空，请上传音乐", "info");
      }

      console.log("✅ 音乐数据加载完成");
    } catch (error) {
      console.error("加载音乐数据失败:", error);
      loadingManager.hide();

      // 确保数据是数组
      state.library = state.library || [];
      state.dailyRecommendations = state.dailyRecommendations || [];

      state.favorites = state.favorites || [];
      state.history = state.history || [];
      state.featuredTracks = state.featuredTracks || [];

      if (state.library.length === 0) {
        utils.showError(
          "加载失败",
          "无法加载音乐库，请检查网络连接或服务器状态",
        );
      } else {
        utils.showMessage("使用缓存数据", "warning");
      }

      // 确保发生灾难性错误时，状态仍可用
      state.library = [];
      state.songIndexById = new Map();
    } finally {
      loadingManager.hide();
    }
  },

  // 加载本地数据
  loadLocalData() {
    try {
      console.log("📦 加载本地数据...");

      // 防御性检查：确保 state.library 已初始化
      if (!state.library || !Array.isArray(state.library)) {
        console.warn("⚠️ state.library 未初始化，设置为空数组");
        state.library = [];
      }

      // 加载收藏数据
      let favoriteIds = [];
      try {
        const stored = localStorage.getItem("musicPlayerFavorites");
        favoriteIds = stored ? JSON.parse(stored) : [];
        // 确保是数组
        if (!Array.isArray(favoriteIds)) {
          favoriteIds = [];
        }
      } catch (e) {
        console.warn("读取收藏数据失败:", e);
        favoriteIds = [];
      }

      // 安全过滤
      state.favorites = state.library.filter((song) => {
        return song && song.id && favoriteIds.includes(song.id);
      });
      console.log(`✅ 已加载 ${state.favorites.length} 首收藏音乐`);

      // 加载历史记录 - 添加多重保护
      let historyIds = [];
      try {
        const stored = localStorage.getItem("musicPlayerHistory");
        historyIds = stored ? JSON.parse(stored) : [];
        // 确保是数组
        if (!Array.isArray(historyIds)) {
          console.warn("历史记录ID不是数组，已重置");
          historyIds = [];
        }
      } catch (e) {
        console.warn("读取历史记录失败:", e);
        historyIds = [];
      }

      // 安全转换和过滤 - 修复：确保historyIds是数组，即使为undefined
      state.history = (historyIds || [])
        .map((id) => {
          if (!id || typeof id !== "string") return null;
          return state.songIndexById.get(id);
        })
        .filter(Boolean)
        .slice(0, 50);

      console.log(`✅ 已加载 ${state.history.length} 条播放历史`);

      // 加载设置
      try {
        const stored = localStorage.getItem("musicPlayerSettings");
        if (stored) {
          const settings = JSON.parse(stored);
          state.settings = { ...state.settings, ...settings };
        }
      } catch (e) {
        console.warn("读取设置失败:", e);
      }

      // 加载主题
      try {
        const theme = localStorage.getItem("musicPlayerTheme");
        if (theme) {
          state.theme = theme;
          document.documentElement.setAttribute("data-theme", theme);
        }
      } catch (e) {
        console.warn("读取主题失败:", e);
      }

      console.log("✅ 本地数据加载完成");
    } catch (error) {
      console.error("❌ 加载本地数据失败:", error);
      // 确保数据是数组，即使出错也不影响应用
      state.favorites = state.favorites || [];
      state.history = state.history || [];
    }
  },

  // 保存本地数据
  saveLocalData() {
    try {
      const favoriteIds = state.favorites.map((song) => song.id);
      localStorage.setItem("musicPlayerFavorites", JSON.stringify(favoriteIds));

      const historyIds = state.history.map((song) => song.id).slice(0, 50);
      localStorage.setItem("musicPlayerHistory", JSON.stringify(historyIds));

      localStorage.setItem(
        "musicPlayerSettings",
        JSON.stringify(state.settings),
      );
      localStorage.setItem("musicPlayerTheme", state.theme);
    } catch (error) {
      console.error("保存本地数据失败:", error);
    }
  },

  // 添加到喜欢
  toggleFavorite(songId) {
    const song = state.songIndexById.get(songId);
    if (!song) return;

    const isFavorite = safeArray.some(
      state.favorites,
      (s) => s && s.id === songId,
    );
    if (isFavorite) {
      state.favorites = safeArray.filter(
        state.favorites,
        (s) => s && s.id !== songId,
      );
      utils.showMessage("已从喜欢中移除", "info");
    } else {
      state.favorites.push(song);
      utils.showMessage("已添加到喜欢", "success");
    }

    this.saveLocalData();

    if (state.currentTrack && state.currentTrack.id === songId) {
      ui.updatePlayerLikeButton();
    }

    if (state.currentPage === "favorites") {
      ui.renderFavoritesPage();
    }
  },

  // 添加到播放历史
  addToHistory(songId) {
    // 首先确保 state.library 已初始化
    if (!state.library || !Array.isArray(state.library)) {
      console.warn("音乐库未初始化，无法添加历史记录");
      return;
    }

    const song = state.songIndexById.get(songId);
    if (!song) {
      console.warn(`歌曲ID ${songId} 不存在，无法添加到历史记录`);
      return;
    }

    // 强制确保 history 是数组
    if (!Array.isArray(state.history)) {
      console.error("state.history 不是数组，已强制重置为空数组");
      state.history = [];
    }

    try {
      // 安全地移除已存在的相同歌曲
      const existingIndex = state.history.findIndex(
        (s) => s && s.id === songId,
      );
      let newHistory = [...state.history];

      if (existingIndex !== -1) {
        newHistory.splice(existingIndex, 1);
      }

      // 添加到开头并限制数量
      newHistory.unshift(song);
      state.history = newHistory.slice(0, 50);

      this.saveLocalData();

      if (state.currentPage === "home") {
        ui.renderRecentTracks();
      }
    } catch (error) {
      console.error("添加历史记录失败:", error);
      // 发生错误时重置 history
      state.history = [];
    }
  },

  // 重新扫描音乐库
  async rescanLibrary() {
    loadingManager.show("正在扫描音乐库...");
    try {
      const result = await api.rescanLibrary();
      utils.showMessage(result.message, "success");
      api.clearCache();
      await this.loadMusicData();
    } catch (error) {
      utils.showMessage(error.message, "error");
    } finally {
      loadingManager.hide();
    }
  },
};

// 在 ui 对象定义之前或内部添加
const lazyLoadManager = {
  observer: null,
  currentList: [],
  container: null,
  batchSize: 20, // 每次渲染多少首，减小以提高性能
  currentIndex: 0,
  sentinel: null,
  isLoading: false, // 是否正在加载

  // 初始化
  init() {
    // 如果已经有观察器，先断开
    if (this.observer) {
      this.observer.disconnect();
    }

    // 获取实际的滚动容器
    const rootElement = document.getElementById('contentArea') || null;
    console.log('lazyLoadManager.init(): 使用滚动容器', rootElement ? 'contentArea' : '视口');

    // 创建 IntersectionObserver
    this.observer = new IntersectionObserver(
      (entries) => {
        // 如果哨兵元素进入视口 (isIntersecting 为 true)
        if (entries[0].isIntersecting) {
          console.log('lazyLoadManager: 哨兵元素进入视口，触发加载更多');
          this.loadMore();
        }
      },
      {
        root: rootElement, // 使用content-area作为滚动容器
        rootMargin: "200px", // 提前 200px 触发加载，体验更流畅
        threshold: 0.1,
      },
    );
  },

  // 开始渲染一个新列表
  start(container, list) {
    console.log('lazyLoadManager.start(): 开始渲染新列表', {listLength: list?.length || 0, container: container?.id || container?.className});
    this.stop(); // 清理旧的观察

    this.container = container;
    this.currentList = Array.isArray(list) ? list : [];
    this.currentIndex = 0;
    this.isLoading = false; // 重置加载状态

    // 清空容器
    container.innerHTML = "";

    if (!this.currentList || this.currentList.length === 0) return;

    // 确保 observer 已初始化
    if (!this.observer) {
      this.init();
    }

    // 渲染第一批
    this.renderBatch();

    // 如果还有剩余数据，设置哨兵
    if (this.currentIndex < this.currentList.length) {
      this.setupSentinel();
    }
  },

  // 停止观察并清理
  stop() {
    console.log('lazyLoadManager.stop(): 停止观察并清理');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.sentinel) {
      this.sentinel.remove();
      this.sentinel = null;
    }
    this.currentList = [];
    this.currentIndex = 0;
    this.isLoading = false;
    this.container = null;
  },

  // 创建并设置哨兵元素
  setupSentinel() {
    // 移除旧哨兵
    if (this.sentinel) this.sentinel.remove();

    // 创建新哨兵
    this.sentinel = document.createElement("div");
    this.sentinel.className = "scroll-sentinel";
    this.sentinel.innerHTML = '<i class="fas fa-spinner"></i> 正在加载更多...';

    // 添加到容器末尾
    this.container.appendChild(this.sentinel);

    // 开始观察
    if (this.observer) {
      console.log('lazyLoadManager.setupSentinel(): 开始观察哨兵元素');
      this.observer.observe(this.sentinel);
    }
  },

  // 加载更多数据
  loadMore() {
    // 如果已经加载完，停止观察
    if (this.currentIndex >= this.currentList.length || this.isLoading) {
      console.log('lazyLoadManager.loadMore(): 跳过加载', {currentIndex: this.currentIndex, listLength: this.currentList.length, isLoading: this.isLoading});
      return;
    }

    console.log('lazyLoadManager.loadMore(): 开始加载更多数据', {currentIndex: this.currentIndex, listLength: this.currentList.length});
    this.isLoading = true; // 设置加载状态

    // 显示加载动画
    if (this.sentinel) this.sentinel.classList.add("loading");

    // 使用 requestAnimationFrame 确保流畅渲染
    requestAnimationFrame(() => {
      // 这里直接渲染即可
      this.renderBatch();

      this.isLoading = false; // 重置加载状态

      // 渲染完后，如果列表到底了，移除哨兵
      if (this.currentIndex >= this.currentList.length) {
        console.log('lazyLoadManager.loadMore(): 所有数据已加载完成，移除哨兵');
        if (this.sentinel) {
          this.sentinel.remove();
          this.sentinel = null;
        }
        if (this.observer) {
          this.observer.disconnect();
        }
      } else {
        // 关键：把哨兵移动到最底部
        // 因为 appendChild 会把元素从原来位置移动到末尾
        console.log('lazyLoadManager.loadMore(): 还有更多数据，移动哨兵到底部');
        this.container.appendChild(this.sentinel);
        if (this.sentinel) this.sentinel.classList.remove("loading");
      }
    });
  },

  // 渲染一批数据
  renderBatch() {
    console.log('lazyLoadManager.renderBatch(): 渲染一批数据', {currentIndex: this.currentIndex, batchSize: this.batchSize});
    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(
      this.currentIndex + this.batchSize,
      this.currentList.length,
    );

    for (let i = this.currentIndex; i < endIndex; i++) {
      const song = this.currentList[i];
      // 调用 ui 的创建卡片方法
      const card = ui.createMusicCard(song);
      fragment.appendChild(card);
      // 添加fade-in类以显示卡片
      card.classList.add("fade-in");
    }

    // 在哨兵之前插入（如果哨兵存在）
    if (this.sentinel && this.sentinel.parentNode === this.container) {
      this.container.insertBefore(fragment, this.sentinel);
    } else {
      this.container.appendChild(fragment);
    }

    console.log(`lazyLoadManager.renderBatch(): 已渲染 ${endIndex - this.currentIndex} 张卡片，当前索引: ${endIndex}`);
    this.currentIndex = endIndex;
  },
};

audioPlayer.addEventListener("error", () => {
  const err = audioPlayer.error;

  // 新增：如果 src 为空，或者 error 为 null，直接忽略，不打印错误
  if (!audioPlayer.getAttribute("src") && !audioPlayer.src) return;

  let msg = "未知音频错误";

  if (err) {
    switch (err.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        msg = "播放被中断";
        break;
      case MediaError.MEDIA_ERR_NETWORK:
        msg = "网络错误，无法加载音频";
        break;
      case MediaError.MEDIA_ERR_DECODE:
        msg = "音频解码失败，文件可能损坏";
        break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        msg = "音频格式不受支持或地址无效";
        break;
    }
  }

  console.error("🎧 音频错误:", msg, err);
});
// 初始化UI

// 调试函数：检查所有数组状态
function debugState() {
  console.group("🔍 状态调试信息");
  console.log("state.library:", state.library?.length || 0, "首歌曲");
  console.log("state.favorites:", state.favorites?.length || 0, "首收藏");
  console.log("state.history:", state.history?.length || 0, "条历史");
  console.log("state.songIndexById:", state.songIndexById?.size || 0, "个索引");
  console.log("state.initialized:", state.initialized);
  console.groupEnd();
}

// UI管理
const ui = {
  // 初始化UI
  async init() {
    try {
      console.log("🚀 开始初始化 UI...");
      debugState(); // 添加调试信息

      // 初始化懒加载管理器
      lazyLoadManager.init();

      console.log("1. 初始化网络管理器...");
      networkManager.init();

      console.log("2. 加载设置...");
      this.loadSettings();

      console.log("3. 初始化主题...");
      this.initTheme();

      console.log("4. 初始化后台播放...");
      utils.initializeBackgroundPlayback();

      console.log("5. 初始化事件监听器...");
      this.initEventListeners();

      console.log("6. 初始化 WebSocket...");
      wsManager.init();

      // 🔴 关键修复：等待音乐数据加载完成
      console.log("7. 加载音乐数据...");
      await musicManager.loadMusicData();

      // 在音乐数据加载后添加
      console.log("✅ 音乐数据加载完成");
      debugState();

      // 加载历史记录
      loadHistoryFromLocalStorage();

      console.log("8. 配置音频播放器...");
      dom.audioPlayer.volume = state.volume;
      this.updateVolumeDisplay();
      this.initPlayerLyrics();
      this.addGlobalEventListeners();

      state.initialized = true;
      console.log("✅ UI 初始化完成");
    } catch (error) {
      console.error("❌ UI 初始化失败:", error);
      console.error("错误堆栈:", error.stack);
      utils.showError("初始化失败", `应用初始化失败: ${error.message}`);
    }
  },

  // 添加计时器管理对象
  uiUpdateTimers: {
    lyrics: null,
    progress: null,
    volume: null,
  },

  // 清理所有计时器
  clearAllTimers() {
    Object.keys(this.uiUpdateTimers).forEach((key) => {
      if (this.uiUpdateTimers[key]) {
        clearTimeout(this.uiUpdateTimers[key]);
        this.uiUpdateTimers[key] = null;
      }
    });
  },

  // 初始化播放器歌词
  initPlayerLyrics() {
    try {
      console.log("🎵 初始化播放器歌词组件...");

      // 确保DOM元素存在
      if (!dom.playerLyricsContainer) {
        console.warn("⚠️ 播放器歌词容器不存在，尝试重新获取");
        dom.playerLyricsContainer = document.getElementById(
          "playerLyricsContainer",
        );
      }

      if (!dom.playerLyricsToggle) {
        console.warn("⚠️ 播放器歌词开关不存在，尝试重新获取");
        dom.playerLyricsToggle = document.getElementById("playerLyricsToggle");
      }

      // 初始化显示状态
      if (state.settings.playerLyricsEnabled) {
        this.enablePlayerLyrics();
      } else {
        this.disablePlayerLyrics();
      }

      // 绑定开关按钮事件
      if (dom.playerLyricsToggle) {
        // 使用更可靠的绑定方式
        // 检查是否已经有事件监听器
        if (!dom.playerLyricsToggle._lyricsToggleHandler) {
          // 创建事件处理函数
          dom.playerLyricsToggle._lyricsToggleHandler = (e) => {
            e.stopPropagation();

            // 保存当前状态以便调试
            const oldState = state.settings.playerLyricsEnabled;

            // 直接切换状态
            state.settings.playerLyricsEnabled = !oldState;

            // 根据新状态更新UI
            if (state.settings.playerLyricsEnabled) {
              this.enablePlayerLyrics();
            } else {
              this.disablePlayerLyrics();
            }

            // 立即保存设置到localStorage
            musicManager.saveLocalData();

            console.log(
              `🎵 歌词功能已${state.settings.playerLyricsEnabled ? "开启" : "关闭"}`,
              { oldState, newState: state.settings.playerLyricsEnabled },
            );
          };

          // 添加事件监听器
          dom.playerLyricsToggle.addEventListener(
            "click",
            dom.playerLyricsToggle._lyricsToggleHandler,
          );
        }
      }

      console.log("✅ 播放器歌词组件初始化完成");
    } catch (error) {
      console.error("❌ 初始化播放器歌词组件失败:", error);
      // 如果初始化失败，确保歌词区域被隐藏
      if (dom.playerLyricsContainer) {
        dom.playerLyricsContainer.style.display = "none";
      }
    }
  },

  // 加载设置
  loadSettings() {
    try {
      if (dom.autoPlayToggle)
        dom.autoPlayToggle.checked = state.settings.autoPlay;
      if (dom.highQualityToggle)
        dom.highQualityToggle.checked = state.settings.highQuality;
      if (dom.showLyricsToggle)
        dom.showLyricsToggle.checked = state.settings.showLyrics;
      if (dom.playerLyricsToggleSetting)
        dom.playerLyricsToggleSetting.checked =
          state.settings.playerLyricsEnabled;
    } catch (error) {
      console.error("加载设置失败:", error);
    }
  },

  // 保存设置
  saveSettings() {
    musicManager.saveLocalData();
  },

  // 初始化主题
  initTheme() {
    try {
      if (dom.themeToggle) dom.themeToggle.checked = state.theme === "light";
      this.updateThemeIcon();
    } catch (error) {
      console.error("初始化主题失败:", error);
    }
  },

  // 切换主题
  toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    musicManager.saveLocalData();
    this.updateThemeIcon();
  },

  // 更新主题图标
  updateThemeIcon() {
    try {
      if (dom.themeIcon) {
        dom.themeIcon.className =
          state.theme === "dark" ? "fas fa-moon" : "fas fa-sun";
        const textElement = dom.themeSwitch?.querySelector(
          ".theme-switch-text div:last-child",
        );
        if (textElement) {
          textElement.textContent =
            state.theme === "dark" ? "暗色模式" : "亮色模式";
        }
      }
    } catch (error) {
      console.error("更新主题图标失败:", error);
    }
  },

  // 添加全局事件监听器（事件委托）
  addGlobalEventListeners() {
    // 使用事件委托处理所有点击事件，避免重复绑定
    document.addEventListener("click", (e) => {
      this.handleGlobalClick(e);
    });

    document.addEventListener(
      "click",
      () => {
        // PC 端
        if (state.audioContext && state.audioContext.state === "suspended") {
          state.audioContext.resume();
        }
      },
      { passive: true },
    );

    // 在 ui.addGlobalEventListeners 中添加
    document.addEventListener(
      "touchstart",
      () => {
        // iOS 必须在 touch 事件中恢复 AudioContext
        if (state.audioContext && state.audioContext.state === "suspended") {
          state.audioContext.resume();
        }
      },
      { passive: true },
    );

    // 侧边栏切换（移动端）
    if (dom.sidebarToggle) {
      dom.sidebarToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        dom.sidebar.classList.toggle("active");
        // 切换侧边栏收起/展开状态（桌面设备）
        dom.sidebar.classList.toggle("collapsed");
      });
    }

    // 点击外部关闭侧边栏
    document.addEventListener("click", (e) => {
      if (
        window.innerWidth <= 1200 &&
        !dom.sidebar.contains(e.target) &&
        !dom.sidebarToggle?.contains(e.target) &&
        dom.sidebar.classList.contains("active")
      ) {
        dom.sidebar.classList.remove("active");
      }
    });

    // 防止页面关闭时丢失数据
    window.addEventListener("beforeunload", (e) => {
      if (state.isPlaying) {
        e.preventDefault();
        e.returnValue = "音乐正在播放，确定要离开吗？";
      }
    });
  },

  // 全局点击处理
  handleGlobalClick(e) {
    const target = e.target;

    // 播放/暂停按钮
    if (target.closest("#playerPlayBtn")) {
      e.stopPropagation();
      player.togglePlay();
      return;
    }

    // 上一首/下一首
    if (target.closest("#playerPrevBtn")) {
      e.stopPropagation();
      player.playPrevious();
      return;
    }
    if (target.closest("#playerNextBtn")) {
      e.stopPropagation();
      player.playNext();
      return;
    }

    // 喜欢按钮
    if (target.closest("#playerLikeBtn") && state.currentTrack) {
      e.stopPropagation();
      musicManager.toggleFavorite(state.currentTrack.id);
      return;
    }

    // 进度条
    if (target.closest("#playerProgressBar")) {
      e.stopPropagation();
      const rect = dom.playerProgressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      player.seek(percent * state.duration);
      return;
    }

    // 音量控制
    if (target.closest("#playerVolumeBtn")) {
      e.stopPropagation();
      player.toggleMute();
      return;
    }
    if (target.closest("#playerVolumeSlider")) {
      e.stopPropagation();
      const rect = dom.playerVolumeSlider.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      player.setVolume(percent);
      return;
    }

    // 随机/循环按钮
    if (target.closest("#playerShuffleBtn")) {
      e.stopPropagation();
      state.isShuffled = !state.isShuffled;
      dom.playerShuffleBtn.style.color = state.isShuffled
        ? "var(--primary-color)"
        : "";
      return;
    }
    if (target.closest("#playerRepeatBtn")) {
      e.stopPropagation();
      const modes = ["none", "one", "all"];
      const currentIndex = modes.indexOf(state.repeatMode);
      state.repeatMode = modes[(currentIndex + 1) % modes.length];

      const icons = ["fa-redo", "fa-redo", "fa-sync"];
      const colors = ["", "var(--primary-color)", "var(--primary-color)"];
      const titles = ["循环播放", "单曲循环", "列表循环"];
      const modeIndex = modes.indexOf(state.repeatMode);

      const iconEl = dom.playerRepeatBtn.querySelector("i");
      if (iconEl) {
        iconEl.className = `fas ${icons[modeIndex]}`;
      }
      dom.playerRepeatBtn.style.color = colors[modeIndex];
      dom.playerRepeatBtn.title = titles[modeIndex];
      return;
    }

    // 导航项
    const navItem = target.closest(".nav-item");
    if (navItem) {
      e.preventDefault();
      const page = navItem.dataset.page;
      if (page) {
        this.switchPage(page);
        if (window.innerWidth <= 1200) {
          dom.sidebar.classList.remove("active");
        }
      }
      return;
    }

    // 音乐卡片点击
    const musicCard = target.closest(".music-card");
    if (musicCard) {
      this.handleMusicCardClick(e, musicCard);
      return;
    }
  },

  // 初始化事件监听器
  initEventListeners() {
    try {
      // 主题切换
      if (dom.themeToggle) {
        dom.themeToggle.addEventListener("change", () => this.toggleTheme());
      }
      // 点击主题切换区域或图标也可以切换主题（当滑动开关隐藏时使用）
      if (dom.themeSwitch) {
        dom.themeSwitch.addEventListener("click", (e) => {
          // 避免点击滑动开关时重复触发
          if (!e.target.closest(".theme-switch-control")) {
            this.toggleTheme();
          }
        });
      }

      // 搜索
      if (dom.searchInput) {
        const debouncedSearch = utils.debounce((query) => {
          if (query.trim() === "") {
            this.renderLibraryPage();
            return;
          }
          this.performSearch(query);
        }, CONFIG.SEARCH_DEBOUNCE_MS);

        dom.searchInput.addEventListener("input", (e) => {
          debouncedSearch(e.target.value);
        });
      }

      // 上传按钮
      const uploadButtons = [
        dom.uploadButton,
        dom.quickUpload,
        dom.addToLibrary,
        dom.libraryUploadButton,
      ];
      uploadButtons.forEach((btn) => {
        if (btn && !btn.hasListener) {
          btn.addEventListener("click", () => dom.fileInput.click());
          btn.hasListener = true;
        }
      });

      // 歌词按钮
      if (dom.lyricsButton) {
        dom.lyricsButton.addEventListener("click", () =>
          this.toggleLyricsPanel(),
        );
      }
      
      // 设置按钮
      if (dom.settingsButton) {
        dom.settingsButton.addEventListener("click", () =>
          this.switchPage("settings"),
        );
      }
      if (dom.lyricsCloseBtn) {
        dom.lyricsCloseBtn.addEventListener("click", () =>
          this.closeLyricsPanel(),
        );
      }

      // 刷新按钮
      if (dom.refreshLibrary) {
        dom.refreshLibrary.addEventListener("click", () =>
          musicManager.loadMusicData(),
        );
      }
      if (dom.refreshRecommendations) {
        dom.refreshRecommendations.addEventListener("click", () =>
          this.refreshDailyRecommendations(),
        );
      }
      if (dom.scanLibrary) {
        dom.scanLibrary.addEventListener("click", () =>
          musicManager.rescanLibrary(),
        );
      }

      // 设置开关
      if (dom.autoPlayToggle) {
        dom.autoPlayToggle.addEventListener("change", (e) => {
          state.settings.autoPlay = e.target.checked;
          this.saveSettings();
        });
      }
      if (dom.highQualityToggle) {
        dom.highQualityToggle.addEventListener("change", (e) => {
          state.settings.highQuality = e.target.checked;
          this.saveSettings();
        });
      }
      if (dom.showLyricsToggle) {
        dom.showLyricsToggle.addEventListener("change", (e) => {
          state.settings.showLyrics = e.target.checked;
          this.saveSettings();
        });
      }
      if (dom.playerLyricsToggleSetting) {
        // 移除旧的事件监听器（防止重复绑定）
        const newToggle = dom.playerLyricsToggleSetting.cloneNode(true);
        if (dom.playerLyricsToggleSetting.parentNode) {
          dom.playerLyricsToggleSetting.parentNode.replaceChild(
            newToggle,
            dom.playerLyricsToggleSetting,
          );
          dom.playerLyricsToggleSetting = newToggle;
        }

        // 添加新的事件监听器
        dom.playerLyricsToggleSetting.addEventListener("change", (e) => {
          try {
            state.settings.playerLyricsEnabled = e.target.checked;
            if (e.target.checked) {
              ui.enablePlayerLyrics();
            } else {
              ui.disablePlayerLyrics();
            }
            this.saveSettings();
            utils.showMessage(
              e.target.checked ? "播放器歌词已启用" : "播放器歌词已禁用",
              "info",
            );
          } catch (error) {
            console.error("切换播放器歌词设置失败:", error);
            utils.showMessage("切换失败，请重试", "error");
          }
        });
      }

      // 文件上传
      if (dom.selectFilesButton) {
        dom.selectFilesButton.addEventListener("click", () =>
          dom.fileInput.click(),
        );
      }
      if (dom.fileInput) {
        dom.fileInput.addEventListener("change", (e) => {
          this.handleFileSelect(e.target.files);
        });
      }

      // 拖放上传
      if (dom.uploadDropArea) {
        dom.uploadDropArea.addEventListener("dragover", (e) => {
          e.preventDefault();
          dom.uploadDropArea.classList.add("dragover");
        });
        dom.uploadDropArea.addEventListener("dragleave", () => {
          dom.uploadDropArea.classList.remove("dragover");
        });
        dom.uploadDropArea.addEventListener("drop", (e) => {
          e.preventDefault();
          dom.uploadDropArea.classList.remove("dragover");
          if (e.dataTransfer.files.length > 0) {
            this.handleFileSelect(e.dataTransfer.files);
          }
        });
      }

      if (dom.startUploadButton) {
        dom.startUploadButton.addEventListener("click", () =>
          this.startUpload(),
        );
      }
      if (dom.clearQueue) {
        dom.clearQueue.addEventListener("click", () => this.clearUploadQueue());
      }

      // 文件上传项移除事件
      if (dom.uploadQueue) {
        dom.uploadQueue.addEventListener("click", (e) => {
          if (e.target.closest(".upload-item-action-btn.remove")) {
            const btn = e.target.closest(".upload-item-action-btn.remove");
            const itemElement = btn.closest(".upload-item");
            const index = parseInt(itemElement.dataset.index);

            if (index >= 0 && index < state.uploadQueue.length) {
              const item = state.uploadQueue[index];

              if (item.status === "uploading") {
                utils.showMessage("当前文件正在上传中，无法移除", "warning");
                return;
              }

              state.uploadQueue.splice(index, 1);
              this.updateUploadQueue();
              utils.showMessage("已从队列中移除", "info");
            }
          }
        });
      }

      // 清空队列按钮事件 - 更新为使用确认对话框
      if (dom.clearQueue) {
        dom.clearQueue.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ui.clearUploadQueue();
        });
      }

      // 音频事件
      dom.audioPlayer.addEventListener("timeupdate", () =>
        player.updateProgress(),
      );
      dom.audioPlayer.addEventListener("loadedmetadata", () => {
        state.duration = dom.audioPlayer.duration;
        dom.playerDuration.textContent = utils.formatTime(state.duration);
      });
      dom.audioPlayer.addEventListener("ended", () => {
        if (state.settings.autoPlay) {
          player.playNext();
        } else {
          state.isPlaying = false;
          this.updatePlayButton();
        }
      });
      dom.audioPlayer.addEventListener("error", (e) => {
        console.error("音频播放错误:", e);
        const errorMsg = player.getAudioErrorMessage(dom.audioPlayer.error);
        utils.showMessage(errorMsg, "error");
      });

      // 音乐源管理
      if (dom.importSourceBtn) {
        dom.importSourceBtn.addEventListener("click", () =>
          this.handleMusicSourceImport(),
        );
      }
      if (dom.sourceUploadArea) {
        dom.sourceUploadArea.addEventListener("click", () =>
          dom.sourceFileInput.click(),
        );
        dom.sourceUploadArea.addEventListener("dragover", (e) => {
          e.preventDefault();
          dom.sourceUploadArea.classList.add("dragover");
        });
        dom.sourceUploadArea.addEventListener("dragleave", () => {
          dom.sourceUploadArea.classList.remove("dragover");
        });
        dom.sourceUploadArea.addEventListener("drop", (e) => {
          e.preventDefault();
          dom.sourceUploadArea.classList.remove("dragover");
          if (e.dataTransfer.files.length > 0) {
            this.handleSourceFileUpload(e.dataTransfer.files[0]);
          }
        });
      }
      if (dom.sourceFileInput) {
        dom.sourceFileInput.addEventListener("change", (e) => {
          if (e.target.files.length > 0) {
            this.handleSourceFileUpload(e.target.files[0]);
          }
        });
      }
    } catch (error) {
      console.error("初始化事件监听器失败:", error);
    }
  },

  // 显示清空队列的右键菜单
  showClearQueueContextMenu(e) {
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.cssText = `
        position: fixed;
        top: ${e.clientY}px;
        left: ${e.clientX}px;
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: 8px 0;
        min-width: 180px;
        box-shadow: var(--shadow-lg);
        z-index: 1000;
        animation: fadeIn 0.2s ease;
    `;

    const options = [
      {
        text: "仅清空已完成",
        icon: "fas fa-check-circle",
        color: "var(--primary-color)",
        action: () => this.clearCompletedUploads(),
      },
      {
        text: "仅清空失败文件",
        icon: "fas fa-times-circle",
        color: "var(--accent-color)",
        action: () => this.clearFailedUploads(),
      },
      { type: "divider" },
      {
        text: "清空所有文件",
        icon: "fas fa-trash-alt",
        color: "var(--accent-color)",
        action: () => this.clearUploadQueue(),
      },
    ];

    options.forEach((option) => {
      if (option.type === "divider") {
        const divider = document.createElement("div");
        divider.style.cssText = `
                height: 1px;
                background: var(--border-color);
                margin: 4px 0;
            `;
        menu.appendChild(divider);
      } else {
        const item = document.createElement("div");
        item.className = "context-menu-item";
        item.style.cssText = `
                padding: 10px 16px;
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                transition: background-color var(--transition-fast);
                color: var(--text-primary);
                font-size: 0.9rem;
            `;

        item.innerHTML = `
                <i class="${option.icon}" style="color: ${option.color}"></i>
                <span>${option.text}</span>
            `;

        item.addEventListener("click", (e) => {
          e.stopPropagation();
          option.action();
          if (menu.parentNode) {
            menu.parentNode.removeChild(menu);
          }
        });

        item.addEventListener("mouseenter", () => {
          item.style.backgroundColor = "var(--bg-hover)";
        });

        item.addEventListener("mouseleave", () => {
          item.style.backgroundColor = "";
        });

        menu.appendChild(item);
      }
    });

    document.body.appendChild(menu);

    // 点击其他地方关闭菜单
    const closeMenu = () => {
      if (menu.parentNode) {
        menu.parentNode.removeChild(menu);
      }
      document.removeEventListener("click", closeMenu);
    };

    setTimeout(() => {
      document.addEventListener("click", closeMenu);
    }, 100);

    // ESC键关闭
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        closeMenu();
        document.removeEventListener("keydown", handleEsc);
      }
    };
    document.addEventListener("keydown", handleEsc);
  },

  // 仅清空已完成的文件
  clearCompletedUploads() {
    const completedItems = state.uploadQueue.filter(
      (item) => item.status === "success",
    );
    if (completedItems.length === 0) {
      utils.showMessage("没有已完成的文件", "info");
      return;
    }

    this.showConfirmDialog(
      "清空已完成文件",
      `确定要移除 ${completedItems.length} 个已上传完成的文件吗？<br><br>
        这不会删除已上传到服务器的文件，仅从上传队列中移除。`,
      () => {
        state.uploadQueue = state.uploadQueue.filter(
          (item) => item.status !== "success",
        );
        this.updateUploadQueue();
        utils.showMessage(
          `已移除 ${completedItems.length} 个已完成文件`,
          "success",
        );
      },
      "fas fa-check-circle",
      "var(--primary-color)",
    );
  },

  // 仅清空失败的文件
  clearFailedUploads() {
    const failedItems = state.uploadQueue.filter(
      (item) => item.status === "error",
    );
    if (failedItems.length === 0) {
      utils.showMessage("没有失败的文件", "info");
      return;
    }

    this.showConfirmDialog(
      "清空失败文件",
      `确定要移除 ${failedItems.length} 个上传失败的文件吗？`,
      () => {
        state.uploadQueue = state.uploadQueue.filter(
          (item) => item.status !== "error",
        );
        this.updateUploadQueue();
        utils.showMessage(`已移除 ${failedItems.length} 个失败文件`, "success");
      },
      "fas fa-times-circle",
      "var(--accent-color)",
    );
  },

  // 设置筛选器事件
  setupFilterEvents(filtersContainer) {
    if (!filtersContainer) return;

    const filterButtons =
      filtersContainer.querySelectorAll(".upload-filter-btn");
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filter = btn.dataset.filter;

        // 更新按钮状态
        filterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // 筛选文件
        this.filterUploadItems(filter);
      });
    });
  },

  // 筛选上传项目
  filterUploadItems(filter) {
    const itemsContainer = document.querySelector(".upload-queue-items");
    if (!itemsContainer) return;

    const allItems = itemsContainer.querySelectorAll(".upload-item");
    let visibleCount = 0;

    allItems.forEach((item) => {
      const status = item.dataset.status;
      const shouldShow = filter === "all" || status === filter;

      item.style.display = shouldShow ? "" : "none";
      if (shouldShow) visibleCount++;
    });

    // 如果没有显示的项目，显示提示
    const existingEmpty = itemsContainer.querySelector(".filter-empty-state");
    if (existingEmpty) existingEmpty.remove();

    if (visibleCount === 0 && allItems.length > 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "upload-queue-empty filter-empty-state";
      emptyState.innerHTML = `
            <i class="fas fa-filter"></i>
            <div class="upload-queue-empty-title">没有匹配的文件</div>
            <div class="upload-queue-empty-description">
                当前筛选条件下没有找到文件
            </div>
        `;
      itemsContainer.appendChild(emptyState);
    }
  },

  // 设置批量操作事件
  setupBatchActions() {
    // 重试失败按钮
    const retryFailedBtn = dom.retryFailedBtn;
    if (retryFailedBtn) {
      retryFailedBtn.addEventListener("click", () => {
        if (!state.uploadLock) {
          this.retryFailedUploads();
        }
      });
    }

    // 全选按钮
    const selectAllBtn = dom.selectAllBtn;
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        this.toggleSelectAll();
      });
    }
  },

  // 切换全选状态
  toggleSelectAll() {
    const selectAllBtn = dom.selectAllBtn;
    const allItems = document.querySelectorAll(".upload-item");
    const hasCheckboxes = allItems[0]?.querySelector(".upload-item-checkbox");

    if (!hasCheckboxes) {
      // 第一次点击全选，添加复选框
      allItems.forEach((item, index) => {
        const checkbox = document.createElement("div");
        checkbox.className = "upload-item-checkbox";
        checkbox.innerHTML = `
                <label class="checkbox-label">
                    <input type="checkbox" class="upload-select-checkbox" data-index="${index}">
                    <span class="checkbox-custom"></span>
                </label>
            `;

        // 插入到状态徽章之前
        const statusBadge = item.querySelector(".upload-item-status-badge");
        if (statusBadge) {
          statusBadge.parentNode.insertBefore(checkbox, statusBadge);
        }
      });

      selectAllBtn.innerHTML = '<i class="fas fa-check-square"></i> 取消全选';
    } else {
      // 切换选中状态
      const checkboxes = document.querySelectorAll(".upload-select-checkbox");
      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);

      checkboxes.forEach((cb) => {
        cb.checked = !allChecked;
        cb.dispatchEvent(new Event("change"));
      });

      selectAllBtn.innerHTML = !allChecked
        ? '<i class="fas fa-check-square"></i> 取消全选'
        : '<i class="far fa-square"></i> 全选';
    }
  },

  // 切换页面
  switchPage(pageName) {
    // --- 1. 关键优化：清理懒加载状态 ---
    if (typeof lazyLoadManager !== "undefined" && lazyLoadManager.stop) {
      lazyLoadManager.stop();
    }

    // --- 2. 移除所有页面的 active 状态 ---
    // 直接使用 .page 类选择所有页面
    const allPages = document.querySelectorAll(".page");
    allPages.forEach((page) => {
      page.classList.remove("active");
    });

    // --- 3. 移除所有导航链接的 active 状态 ---
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach((n) => n.classList.remove("active"));

    // --- 4. 激活目标页面 ---
    // 使用已缓存的页面元素
    const targetPage = dom.pages[pageName] || dom[`${pageName}Page`];

    if (targetPage) {
      targetPage.classList.add("active");
    } else {
      console.warn(`页面元素未找到: ${pageName}`);
      // 如果目标页面不存在，确保至少主页是激活的
      if (dom.pages.home) {
        dom.pages.home.classList.add("active");
        pageName = "home";
      }
    }

    // --- 5. 激活导航栏链接 ---
    // 查找 data-page 属性匹配的导航项
    const targetNav = document.querySelector(
      `.nav-item[data-page="${pageName}"]`,
    );
    if (targetNav) {
      targetNav.classList.add("active");
    }

    // --- 6. 更新状态并渲染 ---
    state.currentPage = pageName;
    this.renderPage(pageName);

    // --- 7. 滚动到顶部 ---
    // 使用实际存在的元素
    const contentArea = dom.contentArea;
    if (contentArea) {
      contentArea.scrollTop = 0;
    }

    console.log(`页面切换至: ${pageName}`);
  },

  // 渲染页面
  renderPage(pageName) {
    try {
      const renderMap = {
        home: this.renderHomePage,
        daily: this.renderDailyPage,
        library: this.renderLibraryPage,
        favorites: this.renderFavoritesPage,
        upload: this.renderUploadPage,
        settings: this.renderSettingsPage,
        discover: this.renderDiscoverPage,
        history: this.renderHistoryPage,
      };
      const renderFunction = renderMap[pageName];
      if (renderFunction) {
        renderFunction.call(this);
      } else {
        console.warn(`未找到页面渲染函数: ${pageName}`);
      }
    } catch (error) {
      console.error(`渲染页面 ${pageName} 失败:`, error);
    }
  },

  // 渲染首页
  renderHomePage() {
    this.updateLibraryStats();
    this.renderFeaturedTracks();
    this.renderRecentTracks();
  },

  // 渲染每日推荐页面
  renderDailyPage() {
    this.renderDailyRecommendations();
  },

  // 渲染音乐库页面
  renderLibraryPage() {
    if (state.library.length === 0) {
      dom.libraryEmpty?.classList.remove("hidden");
      dom.libraryGrid?.classList.add("hidden");
    } else {
      dom.libraryEmpty?.classList.add("hidden");
      dom.libraryGrid?.classList.remove("hidden");
      this.renderMusicGrid(dom.libraryGrid, state.library);
    }
  },

  // 渲染喜欢页面
  renderFavoritesPage() {
    if (state.favorites.length === 0) {
      dom.favoritesEmpty?.classList.remove("hidden");
      dom.favoritesGrid?.classList.add("hidden");
    } else {
      dom.favoritesEmpty?.classList.add("hidden");
      dom.favoritesGrid?.classList.remove("hidden");
      this.renderMusicGrid(dom.favoritesGrid, state.favorites);
    }
  },

  // 渲染上传页面
  renderUploadPage() {
    this.updateUploadQueue();
  },

  // 渲染设置页面
  renderSettingsPage() {
    // 重新加载设置，确保所有开关状态正确
    this.loadSettings();
    
    // 在设置卡片的播放设置部分添加后台播放开关
    const settingsCard = document.querySelector(
      "#settingsPage .stat-card:first-child",
    );
    if (
      settingsCard &&
      !document.getElementById("backgroundPlaybackToggleContainer")
    ) {
      const container = document.createElement("div");
      container.id = "backgroundPlaybackToggleContainer";
      container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 16px;">
                    <div>
                        <div style="font-weight: 500;">后台播放</div>
                        <div style="font-size: 0.9rem; color: var(--text-secondary);">
                            切换网页或标签页时保持音乐播放（需要浏览器支持）
                        </div>
                    </div>
                    <label class="theme-switch-control">
                        <input type="checkbox" class="theme-switch-checkbox" id="backgroundPlaybackToggle" ${state.backgroundPlaybackEnabled ? "checked" : ""}>
                        <span class="theme-slider"></span>
                    </label>
                </div>
            `;
      settingsCard.appendChild(container);

      const backgroundPlaybackToggle = document.getElementById("backgroundPlaybackToggle");
      if (backgroundPlaybackToggle) {
        backgroundPlaybackToggle.addEventListener("change", (e) => {
          state.backgroundPlaybackEnabled = e.target.checked;
          state.settings.backgroundPlayback = e.target.checked;
          this.saveSettings();
          if (state.backgroundPlaybackEnabled) {
            utils.initializeBackgroundPlayback();
            utils.showMessage("后台播放已启用", "success");
          } else {
            utils.cleanupBackgroundPlayback();
            utils.showMessage("后台播放已禁用", "info");
          }
        });
      }
    }
  },

  // 添加缺失的页面渲染函数（如果不存在）
  renderDiscoverPage() {
    const discoverPage = dom.discoverPage;
    if (!discoverPage) return;
    discoverPage.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-compass page-title-icon"></i>
                    发现音乐
                </h1>
                <p class="page-subtitle">探索更多精彩音乐</p>
            </div>
            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <i class="fas fa-compass" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.3;"></i>
                <p>功能开发中...</p>
            </div>
        `;
  },

  renderHistoryPage() {
    const historyPage = dom.historyPage;
    if (!historyPage) return;
    historyPage.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">
                    <i class="fas fa-history page-title-icon"></i>
                    播放历史
                </h1>
                <p class="page-subtitle">您最近播放的音乐</p>
            </div>
            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <i class="fas fa-history" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.3;"></i>
                <p>功能开发中...</p>
            </div>
        `;
  },

  // 渲染音乐网格 - 使用事件委托优化
  renderMusicGrid(container, musicList) {
    if (!container) return;

    // 如果列表为空，直接清空并返回（或者显示空状态）
    // if (!musicList || musicList.length === 0) {
    //     container.innerHTML = '';
    //     // 停止之前的观察
    //     lazyLoadManager.stop();
    //     return;
    // }

    // 使用懒加载管理器接管渲染
    lazyLoadManager.start(container, musicList);
  },

  // 创建音乐卡片
  createMusicCard(song) {
    const isPlaying = state.currentTrack?.id === song.id;
    const isFavorite = state.favorites.some((s) => s.id === song.id);

    const card = document.createElement("div");
    card.className = `music-card ${isPlaying ? "playing" : ""}`;
    card.dataset.id = song.id;

    const coverUrl = song.coverUrl || song.cover_url; // ✅ 兼容两种命名

    let coverHtml = `<div class="music-cover-placeholder"><i class="fas fa-music"></i></div>`;
    if (coverUrl) {
      // 转义标题中的特殊字符，防止在onerror事件处理函数中出现语法错误
      const escapedTitle = song.title
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      coverHtml = `<img src="${coverUrl}" alt="${escapedTitle}" loading="lazy" onerror='handleCoverError(this, "${escapedTitle}")'>`;
    }

    card.innerHTML = `
            <div class="music-cover">
                ${coverHtml}
                <div class="music-cover-overlay">
                    <button class="play-button" aria-label="播放">
                        <i class="fas fa-play"></i>
                    </button>
                </div>
            </div>
            <div class="music-info">
                <div class="music-title text-truncate">${song.title}</div>
                <div class="music-artist text-truncate">${song.artist}</div>
                <div class="music-duration">${utils.formatTime(song.duration || 0)}</div>
            </div>
            <div class="music-actions">
                <button class="music-action-btn identify-btn" aria-label="自动匹配信息" title="自动匹配信息">
                    <i class="fas fa-magic"></i>
                </button>

                <button class="music-action-btn favorite-btn" aria-label="${isFavorite ? "取消喜欢" : "喜欢"}" title="${isFavorite ? "取消喜欢" : "喜欢"}">
                    <i class="${isFavorite ? "fas" : "far"} fa-heart"></i>
                </button>
            </div>
        `;

    return card;
  },

  // 处理音乐卡片点击事件
  handleMusicCardClick(e, card) {
    e.stopPropagation();
    if (!card?.dataset?.id) return;

    const songId = card.dataset.id;
    const now = Date.now();

    // 防止重复点击（500毫秒内）
    if (card._lastClick && now - card._lastClick < 500) {
      return;
    }
    card._lastClick = now;

    if (e.target.closest(".play-button")) {
      player.playSong(songId);
    } else if (e.target.closest(".favorite-btn")) {
      musicManager.toggleFavorite(songId);
      // 更新按钮图标
      const favoriteBtn = card.querySelector(".favorite-btn i");
      const isNowFavorite = safeArray.some(
        state.favorites,
        (s) => s && s.id === songId,
      );
      favoriteBtn.className = isNowFavorite ? "fas fa-heart" : "far fa-heart";
    } else if (e.target.closest(".identify-btn")) {
      this.identifySong(songId);
    } else {
      player.playSong(songId);
    }
  },

  // 新增：处理歌曲识别
  async identifySong(songId) {
    // 1. 获取按钮图标元素以便制作 Loading 动画
    const card = document.querySelector(`.music-card[data-id="${songId}"]`);
    if (!card) return;

    const btnIcon = card.querySelector(".identify-btn i");
    const originalClass = btnIcon ? btnIcon.className : "fas fa-magic";

    // 2. 设置 Loading 状态
    if (btnIcon) btnIcon.className = "fas fa-spinner fa-spin";
    utils.showMessage("正在联网搜索歌曲信息...", "info");

    try {
      // 3. 发送请求
      // 注意：这里直接使用了 fetch，你也可以封装到 api 对象中
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/music/${songId}/identify`,
        {
          method: "POST",
        },
      );
      const result = await response.json();

      // 4. 处理结果
      if (response.ok && result.success) {
        utils.showMessage(
          `匹配成功！来源: ${result.source || "未知"}`,
          "success",
        );

        // 5. 刷新数据以显示新封面和歌名
        // 为了体验更好，可以只更新当前卡片 DOM，但重新加载最稳妥
        await musicManager.loadMusicData();

        // 如果当前正在播放这首歌，更新播放器信息
        if (state.currentTrack && state.currentTrack.id === songId) {
          state.currentTrack = state.songIndexById.get(songId); // 更新当前引用的对象
          ui.updatePlayerInfo();
        }
      } else {
        utils.showMessage(result.error || "未找到匹配信息", "warning");
      }
    } catch (error) {
      console.error("识别失败:", error);
      utils.showMessage("识别请求失败，请检查网络或服务器日志", "error");
    } finally {
      // 6. 恢复按钮状态
      if (btnIcon) btnIcon.className = "fas fa-magic";
    }
  },

  // 渲染热门推荐
  renderFeaturedTracks() {
    if (state.featuredTracks.length > 0) {
      this.renderMusicGrid(dom.featuredGrid, state.featuredTracks);
    } else if (dom.featuredGrid) {
      dom.featuredGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
                    <i class="fas fa-music" style="font-size: 3rem; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>暂无推荐音乐</p>
                </div>
            `;
    }
  },

  // 渲染最近播放
  renderRecentTracks() {
    if (state.history.length > 0) {
      this.renderMusicGrid(dom.recentGrid, state.history);
    } else if (dom.recentGrid) {
      dom.recentGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
                    <i class="fas fa-history" style="font-size: 3rem; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>暂无播放记录</p>
                </div>
            `;
    }
  },

  // 渲染每日推荐
  renderDailyRecommendations() {
    if (state.dailyRecommendations.length > 0) {
      this.renderMusicGrid(dom.dailyGrid, state.dailyRecommendations);
    } else if (dom.dailyGrid) {
      dom.dailyGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
                    <i class="fas fa-calendar-day" style="font-size: 3rem; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>暂无每日推荐</p>
                </div>
            `;
    }
  },

  // 刷新每日推荐
  async refreshDailyRecommendations() {
    loadingManager.show("正在刷新每日推荐...");
    try {
      state.dailyRecommendations = await api.getDailyRecommendations();
      this.renderDailyRecommendations();
      utils.showMessage("每日推荐已刷新", "success");
    } catch (error) {
      console.error("刷新每日推荐失败:", error);
      utils.showMessage("刷新每日推荐失败", "error");
    } finally {
      loadingManager.hide();
    }
  },

  // 更新音乐库统计
  updateLibraryStats() {
    try {
      if (dom.totalSongs) dom.totalSongs.textContent = state.library.length;
      if (dom.totalArtists) {
        const artists = new Set(state.library.map((song) => song.artist));
        dom.totalArtists.textContent = artists.size;
      }
      if (dom.totalDuration) {
        const totalSeconds = state.library.reduce(
          (sum, song) => sum + (song.duration || 0),
          0,
        );
        dom.totalDuration.textContent = Math.round(totalSeconds / 60);
      }
      if (dom.todayRecommend) {
        dom.todayRecommend.textContent = Math.min(
          state.dailyRecommendations.length,
          6,
        );
      }
      if (dom.libraryBadge) dom.libraryBadge.textContent = state.library.length;
      if (dom.dailyBadge)
        dom.dailyBadge.textContent = Math.min(
          state.dailyRecommendations.length,
          6,
        );
    } catch (error) {
      console.error("更新音乐库统计失败:", error);
    }
  },

  // 更新徽章
  updateBadges() {
    this.updateLibraryStats();
    try {
      if (state.currentLyrics && state.currentLyrics.length > 0) {
        dom.lyricsBadge?.classList.remove("hidden");
      } else {
        dom.lyricsBadge?.classList.add("hidden");
      }
    } catch (error) {
      console.error("更新歌词徽章失败:", error);
    }
  },

  // 更新播放器歌词显示
  updatePlayerLyricsDisplay(text, isActive = false) {
    try {
      if (!dom.playerLyricsLine) return;

      const line = dom.playerLyricsLine;
      if (text) {
        line.textContent = text;
        line.classList.remove("loading", "empty");
        if (isActive) {
          line.classList.add("active", "highlight");
          this.checkAndStartLyricsScroll(line);
        } else {
          line.classList.remove("active", "highlight");
          line.classList.add("empty");
          this.stopLyricsScroll();
        }
      } else {
        line.textContent = "暂无歌词";
        line.classList.remove("active", "highlight", "loading");
        line.classList.add("empty");
        this.stopLyricsScroll();
      }
    } catch (error) {
      console.error("更新播放器歌词显示失败:", error);
    }
  },

  // 检查并开始歌词滚动（带节流）
  checkAndStartLyricsScroll: utils.throttle(function (lineElement) {
    this.stopLyricsScroll();
    const scrollContainer = dom.playerLyricsScroll;
    if (!scrollContainer) return;

    const lineWidth = lineElement.scrollWidth;
    const containerWidth = scrollContainer.clientWidth;

    if (lineWidth > containerWidth) {
      const duration = Math.max(lineWidth / 30, 8);

      lineElement.style.animation = `lyricsScroll ${duration}s linear infinite`;
      lineElement.classList.add("playing");
    } else {
      lineElement.style.animation = "";
      lineElement.classList.remove("playing");
    }
  }, 100), // 100ms节流

  // 停止歌词滚动
  stopLyricsScroll() {
    try {
      const line = dom.playerLyricsLine;
      if (line) {
        line.classList.remove("playing");
      }
      if (state.lyricsScrollInterval) {
        clearInterval(state.lyricsScrollInterval);
        state.lyricsScrollInterval = null;
      }
    } catch (error) {
      console.error("停止歌词滚动失败:", error);
    }
  },

  // 查找当前时间对应的歌词行
  findCurrentLyricLine(currentTime, lyrics) {
    if (!lyrics || lyrics.length === 0) return null;
    let currentLine = null;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (lyrics[i].time <= currentTime) {
        currentLine = lyrics[i];
        break;
      }
    }
    return currentLine;
  },

  // 更新播放器歌词
  updatePlayerLyrics(currentTime) {
    if (!state.currentLyrics || !state.settings.playerLyricsEnabled) {
      if (state.currentTrack && !state.currentLyrics) {
        this.updatePlayerLyricsDisplay("歌词加载中...", false);
      }
      return;
    }

    // 清除之前的定时器
    if (this.uiUpdateTimers.lyrics) {
      clearTimeout(this.uiUpdateTimers.lyrics);
    }

    // 延迟50ms执行，避免过于频繁的更新
    this.uiUpdateTimers.lyrics = setTimeout(() => {
      try {
        const currentLyric = this.findCurrentLyricLine(
          currentTime,
          state.currentLyrics,
        );
        if (
          currentLyric &&
          currentLyric.text !== state.playerCurrentLyric?.text
        ) {
          state.playerCurrentLyric = currentLyric;
          const lyricText = currentLyric.text.trim();
          if (lyricText && lyricText !== "//" && lyricText !== "♪") {
            this.updatePlayerLyricsDisplay(lyricText, true);
          } else {
            const meaningfulLyric = this.findMeaningfulLyric(
              currentTime,
              state.currentLyrics,
            );
            if (meaningfulLyric) {
              this.updatePlayerLyricsDisplay(meaningfulLyric.text, true);
            } else {
              this.updatePlayerLyricsDisplay("♪", false);
            }
          }
        } else if (!currentLyric && state.currentLyrics.length > 0) {
          this.updatePlayerLyricsDisplay(state.currentLyrics[0].text, false);
        }
      } catch (error) {
        console.error("更新播放器歌词失败:", error);
      }
    }, 50);
  },

  // 查找有意义的歌词（跳过空白和特殊字符）
  findMeaningfulLyric(currentTime, lyrics) {
    if (!lyrics || lyrics.length === 0) return null;
    for (let i = 0; i < Math.min(10, lyrics.length); i++) {
      if (lyrics[i].time <= currentTime) {
        const lyricText = lyrics[i].text.trim();
        if (lyricText && lyricText !== "//" && lyricText !== "♪") {
          return lyrics[i];
        }
      }
    }
    const currentIndex = lyrics.findIndex((l) => l.time <= currentTime);
    if (currentIndex !== -1) {
      for (
        let i = currentIndex + 1;
        i < Math.min(currentIndex + 10, lyrics.length);
        i++
      ) {
        const lyricText = lyrics[i].text.trim();
        if (lyricText && lyricText !== "//" && lyricText !== "♪") {
          return lyrics[i];
        }
      }
    }
    return null;
  },

  // 清空播放器歌词
  clearPlayerLyrics() {
    state.playerCurrentLyric = null;
    this.updatePlayerLyricsDisplay("暂无歌词", false);
    this.stopLyricsScroll();
  },

  // 歌词加载中状态
  setLyricsLoading() {
    if (state.settings.playerLyricsEnabled && dom.playerLyricsLine) {
      dom.playerLyricsLine.textContent = "歌词加载中";
      dom.playerLyricsLine.classList.add("loading");
      dom.playerLyricsLine.classList.remove("active", "empty", "highlight");
    }
  },

  // 处理文件选择
  handleFileSelect(files) {
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) => {
      const extension = file.name.split(".").pop().toLowerCase();
      const isValidFormat = CONFIG.SUPPORTED_FORMATS.includes(extension);
      const isValidSize = file.size <= CONFIG.UPLOAD_MAX_SIZE;
      return isValidFormat && isValidSize;
    });

    if (validFiles.length === 0) {
      utils.showMessage("没有有效的音频文件", "error");
      return;
    }

    // 检查总文件数量限制
    const currentCount = state.uploadQueue.length;
    const newCount = validFiles.length;
    const totalCount = currentCount + newCount;

    if (totalCount > 20) {
      utils.showMessage(
        `一次最多上传20个文件，当前已有${currentCount}个`,
        "warning",
      );
      return;
    }

    // 检查总文件大小限制
    const currentSize = state.uploadQueue.reduce(
      (sum, item) => sum + item.size,
      0,
    );
    const newSize = validFiles.reduce((sum, file) => sum + file.size, 0);
    const totalSize = currentSize + newSize;

    if (totalSize > 100 * 1024 * 1024) {
      // 100MB
      utils.showMessage("总文件大小不能超过100MB", "warning");
      return;
    }

    validFiles.forEach((file) => {
      const existingFile = state.uploadQueue.find(
        (f) => f.name === file.name && f.size === file.size,
      );
      if (!existingFile) {
        state.uploadQueue.push({
          file: file,
          name: file.name,
          size: file.size,
          status: "pending",
          progress: 0,
        });
      }
    });

    this.switchPage("upload");
    this.updateUploadQueue();
    utils.showMessage(
      `已添加 ${validFiles.length} 个文件到上传队列`,
      "success",
    );
  },

  // 处理音乐源导入
  async handleMusicSourceImport() {
    try {
      // 获取URL输入框的值
      const url = dom.musicSourceUrl.value.trim();

      if (!url) {
        // 如果没有输入URL，显示音乐源管理页面
        this.switchPage("settings");

        // 找到音乐源管理部分并滚动到视图
        const musicSourceSection =
          document.getElementById("musicSourceSection");
        if (musicSourceSection) {
          musicSourceSection.scrollIntoView({ behavior: "smooth" });
          musicSourceSection.classList.add("highlighted");
          setTimeout(
            () => musicSourceSection.classList.remove("highlighted"),
            2000,
          );
        }
        return;
      }

      // 验证URL格式
      if (!this.validateUrl(url)) {
        utils.showMessage("请输入有效的音乐源URL", "error");
        return;
      }

      // 显示进度指示器
      this.showImportProgress(true, "正在获取音乐源...");

      // 调用后端API导入音乐源
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/music-source/import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: url,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "导入失败");
      }

      const result = await response.json();

      // 更新进度指示器
      this.showImportProgress(
        true,
        `导入完成，成功导入 ${result.songsAdded} 首歌曲`,
        100,
      );

      // 显示成功消息
      utils.showMessage(`成功导入 ${result.songsAdded} 首歌曲`, "success");

      // 重新加载音乐数据
      await musicManager.loadMusicData();
      this.renderLibraryPage();

      // 清空URL输入框
      dom.musicSourceUrl.value = "";

      // 隐藏进度指示器
      setTimeout(() => {
        this.showImportProgress(false);
      }, 2000);
    } catch (error) {
      console.error("处理音乐源导入失败:", error);
      utils.showMessage(`音乐源导入失败: ${error.message}`, "error");
      // 隐藏进度指示器
      this.showImportProgress(false);
    }
  },

  // 验证URL格式
  validateUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  },

  // 显示/隐藏导入进度指示器
  showImportProgress(show, message = "", progress = 0) {
    if (!dom.importProgress) return;

    if (show) {
      dom.importProgress.style.display = "block";

      // 更新进度条
      const progressFill = dom.importProgress.querySelector(".progress-fill");
      if (progressFill) {
        progressFill.style.width = `${progress}%`;
      }

      // 更新进度文本
      const progressText = dom.importProgress.querySelector(".progress-text");
      if (progressText) {
        progressText.textContent = message;
      }
    } else {
      dom.importProgress.style.display = "none";

      // 重置进度条
      const progressFill = dom.importProgress.querySelector(".progress-fill");
      if (progressFill) {
        progressFill.style.width = "0%";
      }
    }
  },

  // 处理音乐源文件上传
  async handleSourceFileUpload(file) {
    try {
      if (!file) {
        utils.showMessage("请选择文件", "warning");
        return;
      }

      // 检查文件格式
      const extension = file.name.split(".").pop().toLowerCase();
      if (extension !== "js" && extension !== "json") {
        utils.showMessage(
          "只支持 JavaScript (.js) 和 JSON (.json) 格式的音乐源文件",
          "error",
        );
        return;
      }

      // 显示上传进度
      utils.showMessage(`正在解析音乐源文件: ${file.name}`, "info");

      // 读取文件内容
      const content = await this.readFileContent(file);

      // 验证文件内容
      if (!this.validateMusicSourceContent(content, extension)) {
        utils.showMessage("音乐源文件格式不正确", "error");
        return;
      }

      // 调用后端API导入音乐源
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/music-source/import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: file.name,
            content: content,
            format: extension,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "导入失败");
      }

      const result = await response.json();
      utils.showMessage(`成功导入 ${result.songsAdded} 首歌曲`, "success");

      // 重新加载音乐数据
      await musicManager.loadMusicData();
      this.renderLibraryPage();
    } catch (error) {
      console.error("音乐源文件上传失败:", error);
      utils.showMessage(`音乐源文件上传失败: ${error.message}`, "error");
    }
  },

  // 读取文件内容
  readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error("文件读取失败"));
      reader.readAsText(file);
    });
  },

  // 验证音乐源文件内容
  validateMusicSourceContent(content, format) {
    try {
      if (format === "json") {
        const data = JSON.parse(content);
        return (
          Array.isArray(data) &&
          data.every((item) => item.title && item.file_url)
        );
      } else if (format === "js") {
        // 增强的 JavaScript 文件格式验证
        // 尝试多种可能的导出方式和歌曲变量名
        const validPatterns = [
          /export\s+(const|let|var)\s+songs|export\s+default\s+songs/, // ES模块导出
          /module\.exports\s*=/, // CommonJS导出
          /const\s+songs\s*=|let\s+songs\s*=|var\s+songs\s*=/, // 声明songs变量
          /const\s+music\s*=|let\s+music\s*=|var\s+music\s*=/, // 声明music变量
          /const\s+tracks\s*=|let\s+tracks\s*=|var\s+tracks\s*=/, // 声明tracks变量
        ];

        // 检查是否包含任何有效模式
        return validPatterns.some((pattern) => pattern.test(content));
      }
      return false;
    } catch (error) {
      console.error("音乐源文件验证失败:", error);
      console.log(
        "文件内容预览:",
        content.substring(0, 200) + (content.length > 200 ? "..." : ""),
      );
      return false;
    }
  },

  // 更新上传队列显示 - 横置布局
  updateUploadQueue() {
    if (!dom.uploadQueue) return;

    if (state.uploadQueue.length === 0) {
      dom.uploadQueue.style.display = "none";
      return;
    }

    dom.uploadQueue.style.display = "block";

    // 计算队列统计信息
    const totalCount = state.uploadQueue.length;
    const pendingCount = state.uploadQueue.filter(
      (item) => item.status === "pending",
    ).length;
    const uploadingCount = state.uploadQueue.filter(
      (item) => item.status === "uploading",
    ).length;
    const successCount = state.uploadQueue.filter(
      (item) => item.status === "success",
    ).length;
    const errorCount = state.uploadQueue.filter(
      (item) => item.status === "error",
    ).length;
    const totalSize = state.uploadQueue.reduce(
      (sum, item) => sum + item.size,
      0,
    );

    // 更新队列计数
    if (dom.queueCount) {
      dom.queueCount.textContent = `${totalCount} 个文件 (${utils.formatFileSize(totalSize)})`;
    }

    if (dom.queueReadyCount) {
      dom.queueReadyCount.textContent = pendingCount + uploadingCount;
    }

    if (dom.queueTotalCount) {
      dom.queueTotalCount.textContent = totalCount;
    }

    // 更新清空队列按钮状态
    if (dom.clearQueue) {
      const hasUploading = uploadingCount > 0;
      dom.clearQueue.disabled = hasUploading || totalCount === 0;

      if (hasUploading) {
        dom.clearQueue.title = "有文件正在上传中，无法清空队列";
      } else if (totalCount === 0) {
        dom.clearQueue.title = "上传队列为空";
      } else {
        dom.clearQueue.title = `清空 ${totalCount} 个文件`;
      }

      // 更新按钮文本
      const clearBtnText = dom.clearQueue.querySelector(".clear-btn-text");
      if (clearBtnText) {
        clearBtnText.textContent = `清空队列 (${totalCount})`;
      }
    }

    // 生成统计卡片
    const statsContainer = document.createElement("div");
    statsContainer.className = "upload-queue-stats";
    statsContainer.innerHTML = `
        <div class="upload-stat-card total">
            <div class="upload-stat-value">${totalCount}</div>
            <div class="upload-stat-label">
                <i class="fas fa-layer-group"></i>
                总文件数
            </div>
        </div>
        <div class="upload-stat-card progress">
            <div class="upload-stat-value">${Math.round((successCount / totalCount) * 100) || 0}%</div>
            <div class="upload-stat-label">
                <i class="fas fa-chart-line"></i>
                上传进度
            </div>
        </div>
        <div class="upload-stat-card speed">
            <div class="upload-stat-value">${utils.formatFileSize(totalSize)}</div>
            <div class="upload-stat-label">
                <i class="fas fa-weight-hanging"></i>
                总大小
            </div>
        </div>
        <div class="upload-stat-card time">
            <div class="upload-stat-value">${uploadingCount}</div>
            <div class="upload-stat-label">
                <i class="fas fa-clock"></i>
                上传中
            </div>
        </div>
    `;

    // 清空队列列表
    dom.uploadQueueList.innerHTML = "";

    // 添加统计卡片
    dom.uploadQueueList.appendChild(statsContainer);

    // 添加批量操作栏
    const batchActions = document.createElement("div");
    batchActions.className = "upload-batch-actions";
    batchActions.innerHTML = `
        <div class="batch-stats">
            <div class="batch-total">
                <i class="fas fa-list-ul"></i>
                上传队列详情
            </div>
            <div class="batch-details">
                <div class="batch-details-item pending">
                    <i class="fas fa-clock"></i>
                    <span>${pendingCount} 等待</span>
                </div>
                <div class="batch-details-item uploading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>${uploadingCount} 上传中</span>
                </div>
                <div class="batch-details-item success">
                    <i class="fas fa-check"></i>
                    <span>${successCount} 完成</span>
                </div>
                <div class="batch-details-item error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${errorCount} 失败</span>
                </div>
            </div>
        </div>
        <div class="batch-actions">
            <button class="batch-action-btn success" id="retryFailedBtn" 
                    ${errorCount === 0 ? "disabled" : ""}
                    title="${errorCount > 0 ? `重试 ${errorCount} 个失败文件` : "没有失败文件"}">
                <i class="fas fa-redo"></i>
                重试失败
            </button>
            <button class="batch-action-btn" id="selectAllBtn"
                    ${state.uploadQueue.length === 0 ? "disabled" : ""}
                    title="选择所有文件">
                <i class="far fa-square"></i>
                全选
            </button>
        </div>
    `;
    dom.uploadQueueList.appendChild(batchActions);

    // 添加筛选器
    const filtersContainer = document.createElement("div");
    filtersContainer.className = "upload-queue-filters";
    filtersContainer.innerHTML = `
        <button class="upload-filter-btn active" data-filter="all">
            全部 (${totalCount})
        </button>
        <button class="upload-filter-btn" data-filter="pending">
            等待中 (${pendingCount})
        </button>
        <button class="upload-filter-btn" data-filter="uploading">
            上传中 (${uploadingCount})
        </button>
        <button class="upload-filter-btn" data-filter="success">
            已完成 (${successCount})
        </button>
        <button class="upload-filter-btn" data-filter="error">
            失败 (${errorCount})
        </button>
    `;
    dom.uploadQueueList.appendChild(filtersContainer);

    // 添加上传项目容器
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "upload-queue-items";
    itemsContainer.style.cssText =
      "display: flex; flex-direction: column; gap: 8px;";

    // 添加文件到容器
    let hasItems = false;
    state.uploadQueue.forEach((item, index) => {
      const queueItem = document.createElement("div");
      queueItem.className = `upload-item ${item.status}`;
      queueItem.dataset.index = index;
      queueItem.dataset.status = item.status;

      // 状态配置映射
      const statusConfig = {
        pending: {
          icon: "fas fa-clock",
          text: "等待中",
          class: "pending",
          color: "",
        },
        uploading: {
          icon: "fas fa-spinner fa-spin",
          text: `上传中 ${item.progress}%`,
          class: "uploading",
          color: "var(--primary-color)",
        },
        success: {
          icon: "fas fa-check",
          text: "完成",
          class: "success",
          color: "var(--primary-color)",
        },
        error: {
          icon: "fas fa-exclamation-triangle",
          text: "失败",
          class: "error",
          color: "var(--accent-color)",
        },
      };

      // 获取当前状态配置
      const config = statusConfig[item.status] || statusConfig.pending;
      const statusIcon = config.icon;
      const statusText = config.text;
      const statusClass = config.class;
      const statusColor = config.color;

      // 计算上传速度和剩余时间（模拟）
      const uploadSpeed =
        item.status === "uploading" ? Math.round(Math.random() * 500 + 100) : 0; // KB/s
      const remainingTime =
        item.status === "uploading" && item.progress > 0
          ? Math.round(((100 - item.progress) * 10) / (uploadSpeed / 100))
          : 0; // 秒

      queueItem.innerHTML = `
            <div class="upload-item-status-badge ${statusClass}" style="color: ${statusColor}">
                <i class="${statusIcon}"></i>
            </div>
            
            <div class="upload-item-info">
                <div class="upload-item-name text-truncate" title="${item.name}">
                    ${item.name}
                </div>
                <div class="upload-item-details">
                    <span class="upload-item-size">
                        <i class="fas fa-weight-hanging"></i>
                        ${utils.formatFileSize(item.size)}
                    </span>
                    ${
                      item.status === "error"
                        ? '<span class="upload-item-error"><i class="fas fa-exclamation-circle"></i>上传失败</span>'
                        : item.status === "uploading" && uploadSpeed > 0
                          ? `<span class="upload-item-speed"><i class="fas fa-tachometer-alt"></i>${uploadSpeed} KB/s</span>`
                          : ""
                    }
                </div>
                ${
                  item.status === "uploading" && remainingTime > 0
                    ? `<div class="upload-item-time"><i class="fas fa-hourglass-half"></i>约${remainingTime}秒</div>`
                    : ""
                }
            </div>
            
            <div class="upload-item-progress">
                <div class="upload-item-progress-bar" 
                     style="width: ${item.progress}%; background-color: ${statusColor}">
                    ${
                      item.status === "uploading" || item.status === "success"
                        ? `<div class="upload-item-progress-text">${item.progress}%</div>`
                        : ""
                    }
                </div>
            </div>
            
            <div class="upload-item-status ${item.status}" style="color: ${statusColor}">
                ${statusText}
            </div>
            
            <div class="upload-item-actions">
                ${
                  item.status === "pending" || item.status === "error"
                    ? `<button class="upload-item-action-btn remove" 
                            data-action="remove" 
                            title="从队列中移除"
                            ${state.uploadLock ? "disabled" : ""}>
                        <i class="fas fa-times"></i>
                    </button>`
                    : ""
                }
                ${
                  item.status === "error"
                    ? `<button class="upload-item-action-btn retry" 
                            data-action="retry" 
                            title="重试上传"
                            ${state.uploadLock ? "disabled" : ""}>
                        <i class="fas fa-redo"></i>
                    </button>`
                    : ""
                }
                ${
                  item.status === "success"
                    ? `<button class="upload-item-action-btn view" 
                            data-action="view" 
                            title="查看文件">
                        <i class="fas fa-eye"></i>
                    </button>`
                    : ""
                }
            </div>
        `;

      itemsContainer.appendChild(queueItem);
      hasItems = true;
    });

    if (!hasItems) {
      // 显示空状态
      const emptyState = document.createElement("div");
      emptyState.className = "upload-queue-empty";
      emptyState.innerHTML = `
            <i class="fas fa-inbox"></i>
            <div class="upload-queue-empty-title">上传队列为空</div>
            <div class="upload-queue-empty-description">
                将文件拖放到此处或点击"选择文件"按钮添加文件
            </div>
        `;
      itemsContainer.appendChild(emptyState);
    }

    dom.uploadQueueList.appendChild(itemsContainer);

    // 设置事件监听器
    this.setupUploadItemEvents();
    this.setupFilterEvents(filtersContainer);
    this.setupBatchActions();
  },

  // 设置上传项目事件
  setupUploadItemEvents() {
    if (!dom.uploadQueueList) return;

    // 移除单个事件监听器
    dom.uploadQueueList.addEventListener("click", (e) => {
      const actionBtn = e.target.closest(".upload-item-action-btn");
      if (!actionBtn) return;

      const itemElement = actionBtn.closest(".upload-item");
      const index = parseInt(itemElement.dataset.index);

      if (isNaN(index) || index < 0 || index >= state.uploadQueue.length)
        return;

      const item = state.uploadQueue[index];
      const action = actionBtn.dataset.action;

      e.stopPropagation();

      switch (action) {
        case "remove":
          this.removeUploadItem(index, item);
          break;
        case "retry":
          this.retryUploadItem(index, item);
          break;
      }
    });
  },

  // 开始上传
  async startUpload() {
    // 检查上传锁，防止并发上传
    if (state.uploadLock) {
      utils.showMessage("正在上传中，请稍候", "warning");
      return;
    }

    // 检查是否有待上传的文件
    const pendingFiles = state.uploadQueue.filter(
      (item) => item.status === "pending" || item.status === "error",
    );

    if (pendingFiles.length === 0) {
      utils.showMessage("没有可以上传的文件", "warning");
      return;
    }

    // 设置上传锁和状态
    state.uploadLock = true;
    state.isUploading = true;

    try {
      // 更新开始上传按钮状态
      if (dom.startUploadButton) {
        dom.startUploadButton.disabled = true;
        dom.startUploadButton.innerHTML =
          '<i class="fas fa-spinner fa-spin"></i> 上传中...';
      }

      // 禁用清空队列按钮
      if (dom.clearQueue) {
        dom.clearQueue.disabled = true;
      }

      let successCount = 0;
      let errorCount = 0;
      const totalFiles = pendingFiles.length;

      console.log(`开始上传 ${totalFiles} 个文件...`);

      // 串行上传文件，避免服务器压力过大
      for (let i = 0; i < state.uploadQueue.length; i++) {
        const item = state.uploadQueue[i];

        // 跳过已完成的文件
        if (item.status === "success") continue;

        // 重试错误文件
        if (item.status === "error") {
          item.status = "pending";
          item.progress = 0;
        }

        try {
          // 更新当前文件状态
          item.status = "uploading";
          item.progress = 0;

          // 更新界面显示
          this.updateUploadQueue();

          console.log(`正在上传文件 ${i + 1}/${totalFiles}: ${item.name}`);

          // 显示当前上传文件的进度（模拟进度）
          const progressInterval = setInterval(() => {
            if (item.status === "uploading" && item.progress < 90) {
              item.progress += 10;
              this.updateUploadQueue();
            }
          }, 200);

          try {
            // 实际文件上传
            const result = await api.uploadFile(item.file);

            // 清除进度模拟
            clearInterval(progressInterval);

            if (result.success) {
              item.status = "success";
              item.progress = 100;
              successCount++;

              console.log(`文件上传成功: ${item.name}`);
              utils.showMessage(`文件 ${item.name} 上传成功`, "success");
            } else {
              item.status = "error";
              item.progress = 100;
              errorCount++;

              console.error(`文件上传失败: ${item.name}`, result.error);
              utils.showMessage(
                `文件 ${item.name} 上传失败: ${result.error || "未知错误"}`,
                "error",
              );
            }
          } catch (uploadError) {
            // 清除进度模拟
            clearInterval(progressInterval);

            item.status = "error";
            item.progress = 100;
            errorCount++;

            console.error(`文件上传异常: ${item.name}`, uploadError);

            let errorMessage = "上传失败";
            if (uploadError.message) {
              if (
                uploadError.message.includes("AbortError") ||
                uploadError.message.includes("超时")
              ) {
                errorMessage = "上传超时，请检查网络连接";
              } else if (uploadError.message.includes("NetworkError")) {
                errorMessage = "网络错误，请检查网络连接";
              } else {
                errorMessage = uploadError.message;
              }
            }

            utils.showMessage(`文件 ${item.name} ${errorMessage}`, "error");
          }

          // 更新界面显示
          this.updateUploadQueue();

          // 避免上传过快导致服务器压力过大
          await utils.sleep(500);
        } catch (fileError) {
          console.error(`处理文件 ${item.name} 时发生错误:`, fileError);
          item.status = "error";
          item.progress = 100;
          errorCount++;
          this.updateUploadQueue();
        }
      }

      // 上传完成，显示统计信息
      let summaryMessage = "";
      if (successCount > 0 && errorCount === 0) {
        summaryMessage = `成功上传 ${successCount} 个文件`;
        utils.showMessage(summaryMessage, "success");
      } else if (successCount > 0 && errorCount > 0) {
        summaryMessage = `上传完成: ${successCount} 个成功, ${errorCount} 个失败`;
        utils.showMessage(
          summaryMessage,
          successCount > errorCount ? "success" : "warning",
        );
      } else {
        summaryMessage = `所有 ${errorCount} 个文件上传失败`;
        utils.showMessage(summaryMessage, "error");
      }

      console.log(`上传完成: ${summaryMessage}`);

      // 如果有成功上传的文件，刷新音乐库
      if (successCount > 0) {
        try {
          utils.showMessage("正在更新音乐库...", "info");

          // 清除缓存
          api.clearCache();

          // 重新加载音乐数据
          await musicManager.loadMusicData();

          // 从队列中移除已成功的文件（可选，保持显示）
          // state.uploadQueue = state.uploadQueue.filter(item => item.status !== 'success');
          // this.updateUploadQueue();

          // 如果队列为空，自动切换到音乐库页面
          const remaining = state.uploadQueue.filter(
            (item) => item.status !== "success",
          ).length;

          if (remaining === 0 && state.currentPage === "upload") {
            setTimeout(() => {
              ui.switchPage("library");
              utils.showMessage("上传完成，已切换到音乐库页面", "info");
            }, 2000);
          }
        } catch (refreshError) {
          console.error("刷新音乐库失败:", refreshError);
          utils.showMessage("音乐库更新失败，请手动刷新页面", "error");
        }
      }
    } catch (error) {
      console.error("上传过程中出现未知错误:", error);
      utils.showMessage(
        `上传过程中出现错误: ${error.message || "未知错误"}`,
        "error",
      );
    } finally {
      // 无论成功或失败，都重置上传状态
      state.uploadLock = false;
      state.isUploading = false;

      // 重新启用按钮
      if (dom.startUploadButton) {
        dom.startUploadButton.disabled = false;
        dom.startUploadButton.innerHTML =
          '<i class="fas fa-play"></i> 开始上传';
      }

      if (dom.clearQueue) {
        dom.clearQueue.disabled = false;
      }

      // 更新队列显示
      this.updateUploadQueue();

      // 如果队列中还有文件，显示提示
      const pending = state.uploadQueue.filter(
        (item) => item.status === "pending" || item.status === "error",
      ).length;

      if (pending > 0) {
        utils.showMessage(`还有 ${pending} 个文件等待上传`, "info");
      }
    }
  },

  // 移除单个上传项目
  removeUploadItem(index, item) {
    if (state.uploadLock) {
      utils.showMessage("正在上传中，无法移除文件", "warning");
      return;
    }

    if (item.status === "uploading") {
      utils.showMessage("当前文件正在上传中，无法移除", "warning");
      return;
    }

    // 确认删除单个文件
    this.showConfirmDialog(
      "删除文件",
      `确定要从上传队列中移除文件"${item.name}"吗？`,
      () => {
        state.uploadQueue.splice(index, 1);
        this.updateUploadQueue();
        utils.showMessage("已从队列中移除", "info");
      },
    );
  },

  // 重试单个上传项目
  retryUploadItem(index, item) {
    if (state.uploadLock) {
      utils.showMessage("正在上传中，请稍后再试", "warning");
      return;
    }

    if (item.status !== "error") {
      return;
    }

    // 重置状态为等待中
    state.uploadQueue[index].status = "pending";
    state.uploadQueue[index].progress = 0;
    this.updateUploadQueue();

    utils.showMessage("文件已加入重试队列", "info");
  },

  // 重试所有失败的文件
  async retryFailedUploads() {
    if (state.uploadLock) {
      utils.showMessage("正在上传中，请稍后再试", "warning");
      return;
    }

    const failedItems = state.uploadQueue.filter(
      (item) => item.status === "error",
    );
    if (failedItems.length === 0) {
      utils.showMessage("没有失败的文件可以重试", "info");
      return;
    }

    this.showConfirmDialog(
      "重试失败文件",
      `确定要重试 ${failedItems.length} 个失败的文件吗？`,
      () => {
        // 将所有失败文件状态重置为等待中
        state.uploadQueue.forEach((item) => {
          if (item.status === "error") {
            item.status = "pending";
            item.progress = 0;
          }
        });

        this.updateUploadQueue();
        utils.showMessage(`已重置 ${failedItems.length} 个失败文件`, "success");

        // 如果没有正在上传的文件，自动开始上传
        const hasUploading = state.uploadQueue.some(
          (item) => item.status === "uploading",
        );
        if (!hasUploading && state.settings.autoUpload) {
          setTimeout(() => {
            this.startUpload();
          }, 1000);
        }
      },
    );
  },

  // 清空上传队列
  clearUploadQueue() {
    // 检查是否有正在上传的文件
    const uploadingFiles = state.uploadQueue.filter(
      (item) => item.status === "uploading",
    );

    if (uploadingFiles.length > 0) {
      utils.showMessage(
        "有文件正在上传中，请等待上传完成后再清空队列",
        "warning",
      );
      return;
    }

    if (state.uploadQueue.length === 0) {
      utils.showMessage("上传队列已为空", "info");
      return;
    }

    // 显示确认对话框
    this.showClearQueueConfirm();
  },

  // 显示清空队列确认对话框
  showClearQueueConfirm() {
    const totalCount = state.uploadQueue.length;
    const pendingCount = state.uploadQueue.filter(
      (item) => item.status === "pending",
    ).length;
    const successCount = state.uploadQueue.filter(
      (item) => item.status === "success",
    ).length;
    const errorCount = state.uploadQueue.filter(
      (item) => item.status === "error",
    ).length;

    let message = `这将删除上传队列中的所有文件（共 ${totalCount} 个），此操作不可撤销。<br><br>`;

    if (pendingCount > 0) {
      message += `<strong>${pendingCount} 个文件</strong> 正在等待上传<br>`;
    }
    if (successCount > 0) {
      message += `<strong>${successCount} 个文件</strong> 已上传成功<br>`;
    }
    if (errorCount > 0) {
      message += `<strong>${errorCount} 个文件</strong> 上传失败<br>`;
    }

    message += `<br>确定要继续吗？`;

    this.showConfirmDialog(
      "确认清空上传队列",
      message,
      () => {
        this.performClearQueue();
      },
      "fas fa-trash-alt",
      "var(--accent-color)",
    );
  },

  // 执行清空队列操作
  performClearQueue() {
    const totalCount = state.uploadQueue.length;

    // 动画效果：逐个移除（可选）
    const items = dom.uploadQueueList.querySelectorAll(".upload-item");
    items.forEach((item, index) => {
      setTimeout(() => {
        item.style.opacity = "0";
        item.style.transform = "translateX(-20px)";
      }, index * 50);
    });

    // 清除队列
    setTimeout(
      () => {
        state.uploadQueue = [];
        this.updateUploadQueue();

        // 显示成功消息
        const successMsg = document.createElement("div");
        successMsg.className = "upload-success-message";
        successMsg.innerHTML = `
            <i class="fas fa-check-circle"></i>
            已清空 ${totalCount} 个文件
        `;
        successMsg.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-card);
            border: 2px solid var(--primary-color);
            border-radius: var(--radius-lg);
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideInRight 0.3s ease-out;
            z-index: 1000;
            box-shadow: var(--shadow-md);
        `;

        document.body.appendChild(successMsg);

        setTimeout(() => {
          successMsg.style.animation = "slideOutRight 0.3s ease-out";
          setTimeout(() => {
            if (successMsg.parentNode) {
              successMsg.parentNode.removeChild(successMsg);
            }
          }, 300);
        }, 3000);

        utils.showMessage(`已清空上传队列 (${totalCount} 个文件)`, "success");
      },
      items.length * 50 + 300,
    );
  },

  // 通用确认对话框
  showConfirmDialog(
    title,
    message,
    onConfirm,
    icon = "fas fa-exclamation-triangle",
    iconColor = "var(--accent-color)",
  ) {
    // 创建对话框元素
    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.id = "dynamicConfirmDialog";

    dialog.innerHTML = `
        <div class="confirm-dialog-content">
            <div class="confirm-dialog-header">
                <i class="${icon}" style="color: ${iconColor}"></i>
                <div class="confirm-dialog-title">${title}</div>
            </div>
            <div class="confirm-dialog-message">${message}</div>
            <div class="confirm-dialog-actions">
                <button class="confirm-dialog-btn cancel" id="dynamicDialogCancel">取消</button>
                <button class="confirm-dialog-btn confirm" id="dynamicDialogConfirm">确认</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 显示对话框
    setTimeout(() => {
      dialog.style.display = "flex";
    }, 10);

    // 添加事件监听器
    const cancelBtn = dialog.querySelector("#dynamicDialogCancel");
    const confirmBtn = dialog.querySelector("#dynamicDialogConfirm");

    const closeDialog = () => {
      dialog.style.animation = "dialogSlideOut 0.3s ease-out";
      setTimeout(() => {
        if (dialog.parentNode) {
          dialog.parentNode.removeChild(dialog);
        }
      }, 300);
    };

    cancelBtn.addEventListener("click", closeDialog);
    confirmBtn.addEventListener("click", () => {
      closeDialog();
      if (onConfirm && typeof onConfirm === "function") {
        setTimeout(onConfirm, 100);
      }
    });

    // 点击背景关闭
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    // ESC键关闭
    const handleEscKey = (e) => {
      if (e.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", handleEscKey);
      }
    };
    document.addEventListener("keydown", handleEscKey);

    // 移除事件监听器（清理）
    dialog._cleanup = () => {
      document.removeEventListener("keydown", handleEscKey);
    };

    return dialog;
  },

  // 搜索音乐
  async performSearch(query) {
    try {
      const results = await api.searchMusic(query);
      if (state.currentPage === "library") {
        this.renderMusicGrid(dom.libraryGrid, results);
      }
    } catch (error) {
      console.error("搜索失败:", error);
    }
  },

  // 切换歌词面板
  toggleLyricsPanel() {
    state.lyricsPanelOpen = !state.lyricsPanelOpen;
    if (state.lyricsPanelOpen) {
      dom.lyricsPanel.classList.add("active");
      this.loadLyrics();
    } else {
      dom.lyricsPanel.classList.remove("active");
    }
  },

  // 关闭歌词面板
  closeLyricsPanel() {
    state.lyricsPanelOpen = false;
    dom.lyricsPanel.classList.remove("active");
  },

  // 加载歌词
  async loadLyrics() {
    if (!state.currentTrack) {
      if (dom.lyricsContent) {
        dom.lyricsContent.innerHTML = `
                    <div class="lyric-line">暂无歌词</div>
                    <div class="lyric-line empty"></div>
                    <div class="lyric-line">点击播放音乐以显示歌词</div>
                `;
      }
      if (state.settings.playerLyricsEnabled) {
        this.updatePlayerLyricsDisplay("点击播放音乐显示歌词", false);
      }
      return;
    }

    if (dom.lyricsContent) {
      dom.lyricsContent.innerHTML = `<div class="lyric-line">正在加载歌词...</div>`;
    }
    if (state.settings.playerLyricsEnabled) {
      this.setLyricsLoading();
    }

    try {
      const lyricsText = await api.getLyrics(state.currentTrack.id);
      if (!lyricsText || lyricsText.trim() === "") {
        if (dom.lyricsContent) {
          dom.lyricsContent.innerHTML = `
                        <div class="lyric-line">暂无歌词</div>
                        <div class="lyric-line empty"></div>
                        <div class="lyric-line">未能找到歌词</div>
                    `;
        }
        state.currentLyrics = null;
        if (state.settings.playerLyricsEnabled) {
          this.updatePlayerLyricsDisplay("暂无歌词", false);
        }
        return;
      }

      state.currentLyrics = this.parseLyrics(lyricsText);
      if (state.lyricsPanelOpen) {
        this.displayLyrics();
      }
      this.updateBadges();

      if (
        state.settings.playerLyricsEnabled &&
        state.currentLyrics &&
        state.currentLyrics.length > 0
      ) {
        const firstMeaningfulLyric = this.findMeaningfulLyric(
          0,
          state.currentLyrics,
        );
        if (firstMeaningfulLyric) {
          this.updatePlayerLyricsDisplay(firstMeaningfulLyric.text, false);
        } else {
          this.updatePlayerLyricsDisplay("♪", false);
        }
      } else if (state.settings.playerLyricsEnabled) {
        this.updatePlayerLyricsDisplay("暂无歌词", false);
      }
    } catch (error) {
      console.error("加载歌词失败:", error);
      if (dom.lyricsContent) {
        dom.lyricsContent.innerHTML = `
                    <div class="lyric-line">加载歌词失败</div>
                    <div class="lyric-line empty"></div>
                    <div class="lyric-line">请检查网络连接</div>
                `;
      }
      if (state.settings.playerLyricsEnabled) {
        this.updatePlayerLyricsDisplay("加载歌词失败", false);
      }
    }
  },

  // 解析歌词
  parseLyrics(lyricsText) {
    if (!lyricsText) return null;
    const lines = lyricsText.split("\n");
    const lyrics = [];
    const timeRegex = /\[(\d+):(\d+\.?\d*)\]/g;

    lines.forEach((line) => {
      const matches = [...line.matchAll(timeRegex)];
      if (matches.length > 0) {
        const text = line.replace(timeRegex, "").trim();
        if (text) {
          matches.forEach((match) => {
            const minutes = parseInt(match[1]);
            const seconds = parseFloat(match[2]);
            const time = minutes * 60 + seconds;
            lyrics.push({ time, text });
          });
        }
      }
    });

    lyrics.sort((a, b) => a.time - b.time);
    return lyrics.length > 0 ? lyrics : null;
  },

  // 显示歌词
  displayLyrics() {
    if (!state.currentLyrics || !dom.lyricsContent) return;
    let html = "";
    for (let i = 0; i < Math.min(state.currentLyrics.length, 20); i++) {
      html += `<div class="lyric-line" data-time="${state.currentLyrics[i].time}">${state.currentLyrics[i].text}</div>`;
    }
    dom.lyricsContent.innerHTML = html;
  },

  // 更新歌词高亮
  updateLyricsHighlight(currentTime) {
    if (!state.currentLyrics || !state.lyricsPanelOpen || !dom.lyricsContent)
      return;

    const lines = dom.lyricsContent.querySelectorAll(".lyric-line");
    if (lines.length === 0) return;

    let activeIndex = -1;
    for (let i = 0; i < state.currentLyrics.length; i++) {
      if (state.currentLyrics[i].time <= currentTime) {
        activeIndex = i;
      } else {
        break;
      }
    }

    lines.forEach((line, index) => {
      line.classList.remove("active");
      const displayIndex = Math.max(0, activeIndex - 5 + index);
      if (displayIndex < state.currentLyrics.length) {
        line.textContent = state.currentLyrics[displayIndex].text;
        line.dataset.time = state.currentLyrics[displayIndex].time;
        if (displayIndex === activeIndex) {
          line.classList.add("active");
          line.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        line.textContent = "";
        line.classList.add("empty");
      }
    });
  },

  // 更新播放按钮
  updatePlayButton() {
    try {
      if (!dom.playerPlayBtn) return;
      const icon = dom.playerPlayBtn?.querySelector("i");
      if (!icon) return;
      if (state.isPlaying) {
        icon.className = "fas fa-pause";
        dom.playerPlayBtn.title = "暂停";
      } else {
        icon.className = "fas fa-play";
        dom.playerPlayBtn.title = "播放";
      }
    } catch (error) {
      console.error("更新播放按钮失败:", error);
    }
  },

  // 更新播放器信息
  updatePlayerInfo() {
    const coverUrl =
      state.currentTrack.coverUrl || state.currentTrack.cover_url; // 兼容旧版字段

    if (!state.currentTrack) {
      if (dom.playerTitle) dom.playerTitle.textContent = "未播放";
      if (dom.playerArtist) dom.playerArtist.textContent = "-";
      if (dom.playerCover) {
        dom.playerCover.innerHTML =
          '<i class="fas fa-music" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 1.5rem; color: var(--text-tertiary);"></i>';
      }
      return;
    }

    try {
      dom.playerTitle.textContent = state.currentTrack.title;
      dom.playerArtist.textContent = state.currentTrack.artist;

      if (coverUrl && dom.playerCover) {
        const escapedTitle = JSON.stringify(state.currentTrack.title).slice(
          1,
          -1,
        );
        dom.playerCover.innerHTML = `<img src="${coverUrl}" alt="${state.currentTrack.title}" loading="lazy" onerror='handleCoverError(this, "${escapedTitle}")'>`;
      } else if (dom.playerCover) {
        dom.playerCover.innerHTML = utils.createCoverPlaceholder(
          state.currentTrack.title,
        );
      }

      this.updatePlayerLikeButton();
    } catch (error) {
      console.error("更新播放器信息失败:", error);
    }
  },

  // 更新喜欢按钮
  updatePlayerLikeButton() {
    if (!state.currentTrack) return;

    try {
      const isFavorite = safeArray.some(
        state.favorites,
        (s) => s && s.id === state.currentTrack.id,
      );
      const icon = dom.playerLikeBtn?.querySelector("i");
      if (!icon) return;

      if (isFavorite) {
        icon.className = "fas fa-heart";
        dom.playerLikeBtn.classList.add("liked");
      } else {
        icon.className = "far fa-heart";
        dom.playerLikeBtn.classList.remove("liked");
      }
    } catch (error) {
      console.error("更新喜欢按钮失败:", error);
    }
  },

  // 更新进度显示
  updateProgressDisplay() {
    try {
      if (dom.playerCurrentTime)
        dom.playerCurrentTime.textContent = utils.formatTime(state.currentTime);
      if (dom.playerProgressFilled)
        dom.playerProgressFilled.style.width = `${(state.currentTime / state.duration) * 100 || 0}%`;
    } catch (error) {
      console.error("更新进度显示失败:", error);
    }
  },

  // 更新音量显示
  updateVolumeDisplay() {
    try {
      if (dom.playerVolumeFilled)
        dom.playerVolumeFilled.style.width = `${state.volume * 100}%`;
      const icon = dom.playerVolumeBtn?.querySelector("i");
      if (!icon) return;

      if (state.isMuted || state.volume === 0) {
        icon.className = "fas fa-volume-mute";
      } else if (state.volume < 0.5) {
        icon.className = "fas fa-volume-down";
      } else {
        icon.className = "fas fa-volume-up";
      }
    } catch (error) {
      console.error("更新音量显示失败:", error);
    }
  },

  enablePlayerLyrics() {
    try {
      console.log("🎵 启用播放器歌词功能");

      // 更新状态
      state.settings.playerLyricsEnabled = true;

      // 显示歌词容器
      if (dom.playerLyricsContainer) {
        dom.playerLyricsContainer.style.display = "flex";
        dom.playerLyricsContainer.classList.add("active");
      }

      // 更新开关按钮状态
      if (dom.playerLyricsToggle) {
        dom.playerLyricsToggle.classList.add("active");
      }

      // 更新状态文本
      if (dom.playerLyricsStatus) {
        dom.playerLyricsStatus.textContent = "歌词开";
        dom.playerLyricsStatus.classList.add("active");
      }

      // 如果有当前歌词，显示第一条
      if (state.currentLyrics && state.currentLyrics.length > 0) {
        const firstMeaningfulLyric = this.findMeaningfulLyric(
          0,
          state.currentLyrics,
        );
        if (firstMeaningfulLyric) {
          this.updatePlayerLyricsDisplay(firstMeaningfulLyric.text, false);
        }
      } else if (state.currentTrack) {
        this.updatePlayerLyricsDisplay("歌词加载中...", false);
      } else {
        this.updatePlayerLyricsDisplay("点击播放音乐显示歌词", false);
      }

      console.log("✅ 播放器歌词已启用");
    } catch (error) {
      console.error("❌ 启用播放器歌词失败:", error);
      // 不抛出错误，避免影响应用运行
    }
  },

  disablePlayerLyrics() {
    try {
      console.log("🎵 禁用播放器歌词功能");

      // 更新状态
      state.settings.playerLyricsEnabled = false;

      // 隐藏歌词容器
      if (dom.playerLyricsContainer) {
        dom.playerLyricsContainer.style.display = "none";
        dom.playerLyricsContainer.classList.remove("active");
      }

      // 更新开关按钮状态
      if (dom.playerLyricsToggle) {
        dom.playerLyricsToggle.classList.remove("active");
      }

      // 更新状态文本
      if (dom.playerLyricsStatus) {
        dom.playerLyricsStatus.textContent = "歌词关";
        dom.playerLyricsStatus.classList.remove("active");
      }

      // 清除歌词显示
      if (dom.playerLyricsLine) {
        dom.playerLyricsLine.textContent = "";
        dom.playerLyricsLine.classList.remove("active", "playing", "highlight");
      }

      // 停止滚动动画
      this.stopLyricsScroll();

      console.log("✅ 播放器歌词已禁用");
    } catch (error) {
      console.error("❌ 禁用播放器歌词失败:", error);
      // 不抛出错误，避免影响应用运行
    }
  },
};

// 播放器控制
const player = {
  currentAudio: null,
  isSeeking: false,
  isLoading: false,
  retryCount: 0,
  maxRetries: CONFIG.MAX_RETRIES,

  async precheckAudioUrl(url) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      console.log("音频文件预检查:", {
        url: url,
        status: response.status,
        size: response.headers.get("Content-Length"),
        type: response.headers.get("Content-Type"),
      });
      return response.ok;
    } catch (error) {
      console.warn("音频文件预检查失败:", error);
      return false; // 仍让浏览器尝试播放
    }
  },

  async testAudioUrl(url) {
    try {
      console.log("测试音频URL:", url);

      // 使用 HEAD 请求检查文件是否存在
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          Accept: "audio/*",
        },
      });

      console.log("URL测试结果:", {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("Content-Type"),
        contentLength: response.headers.get("Content-Length"),
      });

      return response.ok;
    } catch (error) {
      console.warn("URL测试失败:", error);
      return false; // 返回 false，但让浏览器尝试播放
    }
  },

  // 播放指定ID的歌曲
  async playSong(songId) {
    console.log("🎵 playSong 被调用，songId:", songId);

    // 先检查音乐库是否已加载
    if (
      !state.library ||
      !Array.isArray(state.library) ||
      state.library.length === 0
    ) {
      console.error("❌ 音乐库未加载或为空");
      utils.showMessage("音乐库未加载或为空", "warning");
      return;
    }

    if (this.isLoading) {
      console.log("正在加载，请稍候...");
      return;
    }

    let song = state.songIndexById.get(songId);

    console.log("🔍 查找歌曲:", {
      songId,
      found: !!song,
      song: song,
      fromIndex: true,
    });

    if (!song) {
      // 尝试直接从库中查找
      song = safeArray.find(state.library, (s) => s && s.id === songId);
      console.log("🔍 从库中查找:", {
        found: !!song,
        libraryLength: state.library.length,
      });

      if (!song) {
        console.error("❌ 找不到歌曲，songId:", songId);
        utils.showMessage("找不到指定的音乐", "error");
        return;
      }
    }

    const fileUrl = song.fileUrl || song.file_url; // ✅ 兼容两种命名

    // 检查文件URL
    console.log("📄 歌曲文件信息:", {
      title: song.title,
      fileUrl: fileUrl,
      filename: song.filename,
    });

    if (!fileUrl) {
      console.error("❌ 歌曲缺少 fileUrl/file_url:", song);
      utils.showMessage("音频文件URL无效", "error");
      this.isLoading = false;
      return;
    }

    if (!utils.isAudioFormatSupported(song.fileUrl)) {
      utils.showAudioFormatError(song.filename || song.fileUrl);
      return;
    }

    this.isLoading = true;

    try {
      const fixedUrl = utils.fixAudioUrl(fileUrl);
      console.log("尝试播放音频:", {
        url: fixedUrl,
        original: fileUrl,
        filename: song.filename,
        title: song.title,
      });

      // 测试 URL 是否有效
      const urlValid = await this.testAudioUrl(fixedUrl);
      if (!urlValid) {
        console.warn("URL测试失败，但仍尝试播放");
      }

      this.cleanupCurrentAudio();

      const audio = new Audio();
      audio.preload = "metadata";
      audio.crossOrigin = "anonymous";

      // 继承当前音量和静音状态
      audio.volume = state.volume;
      audio.muted = state.isMuted;

      this.setupAudioEvents(audio);
      audio.src = fixedUrl;
      audio.load();

      state.currentTrack = song;
      this.currentAudio = audio;

      ui.updatePlayerInfo();
      ui.clearPlayerLyrics();

      musicManager.addToHistory(songId);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          audio.removeEventListener("loadedmetadata", onLoadedMetadata);
          audio.removeEventListener("error", onError);
          reject(new Error("音频加载超时"));
        }, 10000);

        const onLoadedMetadata = () => {
          clearTimeout(timeout);
          audio.removeEventListener("loadedmetadata", onLoadedMetadata);
          audio.removeEventListener("error", onError);
          resolve();
        };

        const onError = (error) => {
          clearTimeout(timeout);
          audio.removeEventListener("loadedmetadata", onLoadedMetadata);
          audio.removeEventListener("error", onError);
          reject(new Error("音频加载失败"));
        };

        audio.addEventListener("loadedmetadata", onLoadedMetadata, {
          once: true,
        });
        audio.addEventListener("error", () => {
          const err = audio.error;
          console.error("❌ audio error", err?.code, err?.message);
        });
      });

      try {
        await utils.startPlaybackWithWebAudio(audio);
        state.isPlaying = true;
        ui.updatePlayButton();
        this.retryCount = 0;

        console.log("播放成功:", song.title);

        if (state.settings.showLyrics) {
          ui.setLyricsLoading();
          setTimeout(() => ui.loadLyrics(), 500);
        }

        ui.renderPage(state.currentPage);
      } catch (playError) {
        console.error("播放失败:", playError);
        if (playError.name === "NotAllowedError") {
          utils.showMessage("请点击播放按钮开始播放", "warning");
          // audio.pause();
          this.pause();
          state.isPlaying = false;
          ui.updatePlayButton();
        } else {
          this.handlePlayError(playError, song, fixedUrl);
        }
      }
    } catch (error) {
      console.error("播放流程失败:", error);
      const errorMessage = error.message.includes("超时")
        ? "音频加载超时，请检查网络连接"
        : error.message.includes("找不到")
          ? "找不到指定的音乐"
          : "播放失败: " + error.message;
      utils.showMessage(errorMessage, "error");
      this.cleanupCurrentAudio();
      state.isPlaying = false;
      ui.updatePlayButton();
    } finally {
      this.isLoading = false;
    }
  },

  // 处理播放错误
  async handlePlayError(error, song, url) {
    console.error("播放错误:", error);

    if (this.retryCount >= this.maxRetries) {
      this.showFinalError(song, error);
      return;
    }

    this.retryCount++;
    console.log(`尝试重新播放 (${this.retryCount}/${this.maxRetries})...`);

    await utils.sleep(1000 * this.retryCount);

    try {
      if (this.currentAudio && this.currentAudio.src) {
        await this.currentAudio.play();
        state.isPlaying = true;
        ui.updatePlayButton();
        console.log("重新播放成功");
      }
    } catch (retryError) {
      console.error("重新播放失败:", retryError);
      if (this.retryCount >= this.maxRetries) {
        this.showFinalError(song, error);
      } else {
        return this.handlePlayError(retryError, song, url);
      }
    }
  },

  // 显示最终错误信息
  showFinalError(song, error) {
    console.error("最终播放失败:", error);

    let errorMessage = "播放失败";
    let showFormatError = false;

    if (error.message && error.message.includes("超时")) {
      errorMessage = "加载超时，请检查网络连接";
    } else if (error.name === "NotAllowedError") {
      errorMessage = "播放被阻止，请确保页面已获得用户交互";
    } else if (error.name === "NotSupportedError") {
      errorMessage = "浏览器不支持此音频格式";
      showFormatError = true;
    } else if (error.name === "NetworkError") {
      errorMessage = "网络错误，请检查网络连接";
    } else if (error.name === "AbortError") {
      errorMessage = "播放被中止";
    } else {
      errorMessage = `播放失败: ${error.message || "未知错误"}`;
    }

    // 显示格式错误提示
    if (showFormatError && song && song.filename) {
      utils.showAudioFormatError(song.filename);
    } else {
      utils.showMessage(errorMessage, "error");
    }

    this.cleanupCurrentAudio();
    state.isPlaying = false;
    ui.updatePlayButton();
  },

  // 设置音频事件
  setupAudioEvents(audio) {
    if (audio._listenersAdded) {
      this.removeAudioEvents(audio);
    }
    audio._listenersAdded = true;

    const handleTimeUpdate = () => {
      if (!this.isSeeking) {
        this.updateProgress();
      }
    };

    const handleLoadedMetadata = () => {
      state.duration = audio.duration;
      dom.playerDuration.textContent = utils.formatTime(state.duration);
    };

    const handleEnded = () => {
      state.isPlaying = false;
      ui.updatePlayButton();
      utils.releaseWakeLock();
      if (state.settings.autoPlay) {
        setTimeout(() => this.playNext(), 1000);
      }
    };

    const handleError = (event) => {
      console.error("音频播放错误事件:", event, audio.error);

      const error = audio.error;
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            console.log("播放被中止（可能用户切换了歌曲）");
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            utils.showMessage("网络错误，无法加载音频", "error");
            break;
          case MediaError.MEDIA_ERR_DECODE:
            utils.showMessage("音频解码失败，文件可能损坏", "error");
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            console.error("音频格式不支持或URL无效:", audio.src);
            utils.showMessage(
              `音频格式不支持: ${song?.filename || "未知文件"}`,
              "error",
            );
            break;
          default:
            console.error("未知音频错误:", error);
        }
      }

      // 清理并重置状态
      this.cleanupCurrentAudio();
      state.isPlaying = false;
      ui.updatePlayButton();
    };

    const handleSeeking = () => {
      this.isSeeking = true;
    };
    const handleSeeked = () => {
      this.isSeeking = false;
    };

    const handlePlay = () => {
      if (
        state.backgroundPlaybackEnabled &&
        state.audioContext &&
        state.audioContext.state === "suspended"
      ) {
        utils.resumeAudioContext();
      }
      if (state.isPlaying) {
        utils.requestWakeLock();
      }
    };

    const handlePause = () => {
      utils.releaseWakeLock();
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("seeking", handleSeeking);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    audio._eventHandlers = {
      timeupdate: handleTimeUpdate,
      loadedmetadata: handleLoadedMetadata,
      ended: handleEnded,
      error: handleError,
      seeking: handleSeeking,
      seeked: handleSeeked,
      play: handlePlay,
      pause: handlePause,
    };
  },

  // 移除音频事件
  removeAudioEvents(audio) {
    if (!audio || !audio._eventHandlers) return;
    Object.entries(audio._eventHandlers).forEach(([event, handler]) => {
      audio.removeEventListener(event, handler);
    });
    delete audio._eventHandlers;
    delete audio._listenersAdded;
  },

  // 清理当前音频
  cleanupCurrentAudio() {
    utils.releaseWakeLock();

    // 1. 清理动态创建的音频对象 (this.currentAudio)
    if (this.currentAudio) {
      this.removeAudioEvents(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    // 2. 清理页面上的全局 audioPlayer 元素
    if (dom.audioPlayer) {
      // 暂时移除错误监听，防止报错
      const clone = dom.audioPlayer.cloneNode(true);
      // 注意：cloneNode 会移除动态绑定的监听器，但保留 HTML 属性
      // 如果你想保留其他监听器，可以使用下面的方法：

      dom.audioPlayer.pause();

      // 关键修改：不要设置 src = ''，而是移除属性
      dom.audioPlayer.removeAttribute("src");

      // 关键修改：不要调用 load()，因为没有 src 时 load() 会报错
      // dom.audioPlayer.load();
    }

    if (state.audioSource) {
      state.audioSource.disconnect();
      state.audioSource = null;
    }
    this.isLoading = false;
    this.isSeeking = false;
  },

  // 获取音频错误消息
  getAudioErrorMessage(error) {
    if (!error) return "音频播放错误";
    switch (error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return "播放被中止";
      case MediaError.MEDIA_ERR_NETWORK:
        return "网络错误，请检查网络连接";
      case MediaError.MEDIA_ERR_DECODE:
        return "音频解码错误，文件可能已损坏或不支持";
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return "音频格式不支持，请尝试其他文件";
      default:
        return "音频播放错误";
    }
  },

  // 添加保存播放历史到本地存储的函数
  saveHistoryToLocalStorage() {
    // 将播放历史保存到 localStorage
    if (state.history) {
      localStorage.setItem("playHistory", JSON.stringify(state.history));
    }
  },

  // 播放
  async play() {
    if (this.isLoading) return;
    if (!this.currentAudio && state.currentTrack) {
      this.playSong(state.currentTrack.id);
      return;
    }

    if (this.currentAudio) {
      try {
        if (state.backgroundPlaybackEnabled && state.audioContext) {
          await utils.startPlaybackWithWebAudio(this.currentAudio);
        } else {
          await this.currentAudio.play();
        }
        state.isPlaying = true;
        ui.updatePlayButton();
        if (state.settings.playerLyricsEnabled && state.playerCurrentLyric) {
          const line = dom.playerLyricsLine;
          line.style.animationPlayState = "running";
          line.classList.add("playing");
        }
      } catch (error) {
        console.error("播放失败:", error);
        if (error.name === "NotAllowedError") {
          utils.showMessage("请先点击播放按钮启用音频播放", "warning");
        } else {
          utils.showMessage("无法播放此音乐文件", "error");
        }
      }
    }
  },

  // 暂停
  pause() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      state.isPlaying = false;
      ui.updatePlayButton();
      utils.releaseWakeLock();
      if (state.settings.playerLyricsEnabled) {
        ui.stopLyricsScroll();
      }
    }
  },

  // 切换播放/暂停
  togglePlay() {
    if (!state.currentTrack && state.library.length > 0) {
      this.playSong(state.library[0].id);
    } else if (state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

  // 播放上一首
  playPrevious() {
    // 首先检查音乐库是否存在且有内容
    if (
      !state.library ||
      !Array.isArray(state.library) ||
      state.library.length === 0 ||
      !state.currentTrack
    ) {
      console.warn("音乐库为空或当前没有播放的歌曲");
      return;
    }

    let prevIndex;
    const currentIndex = safeArray.findIndex(
      state.library,
      (song) => song && song.id === state.currentTrack.id,
    );

    if (currentIndex === -1) {
      console.warn("当前歌曲不在音乐库中，从最后一首开始播放");
      prevIndex = state.library.length - 1;
    } else {
      prevIndex = currentIndex - 1;
      if (prevIndex < 0) {
        if (state.repeatMode === "all") {
          prevIndex = state.library.length - 1;
        } else {
          utils.showMessage("已经是第一首歌曲", "info");
          return;
        }
      }
    }

    // 获取上一首歌曲
    const prevSong = state.library[prevIndex];
    if (prevSong && prevSong.id) {
      this.playSong(prevSong.id);
    } else {
      console.error("无法获取上一首歌曲");
      utils.showMessage("无法播放上一首歌曲", "error");
    }
  },

  // 播放下一首
  playNext() {
    // 首先检查音乐库是否存在且有内容
    if (
      !state.library ||
      !Array.isArray(state.library) ||
      state.library.length === 0 ||
      !state.currentTrack
    ) {
      console.warn("音乐库为空或当前没有播放的歌曲");
      return;
    }

    let nextIndex;
    if (state.isShuffled) {
      nextIndex = Math.floor(Math.random() * state.library.length);
    } else {
      const currentIndex = safeArray.findIndex(
        state.library,
        (song) => song && song.id === state.currentTrack.id,
      );

      if (currentIndex === -1) {
        console.warn("当前歌曲不在音乐库中，从第一首开始播放");
        nextIndex = 0;
      } else {
        nextIndex = currentIndex + 1;

        if (nextIndex >= state.library.length) {
          if (state.repeatMode === "all") {
            nextIndex = 0;
          } else {
            this.pause();
            utils.showMessage("已播放到最后一首", "info");
            return;
          }
        }
      }
    }

    // 获取下一首歌曲
    const nextSong = state.library[nextIndex];
    if (nextSong && nextSong.id) {
      this.playSong(nextSong.id);
    } else {
      console.error("无法获取下一首歌曲");
      utils.showMessage("无法播放下一首歌曲", "error");
    }
  },

  // 跳转到指定时间
  seek(time) {
    if (this.currentAudio && this.currentAudio.duration) {
      this.currentAudio.currentTime = time;
      state.currentTime = time;
      ui.updateProgressDisplay();
      if (state.lyricsPanelOpen) {
        ui.updateLyricsHighlight(time);
      }
    }
  },

  // 设置音量
  setVolume(volume) {
    state.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = state.volume;
      this.currentAudio.muted = false;
    }
    state.isMuted = false;
    ui.updateVolumeDisplay();
  },

  // 静音/取消静音
  toggleMute() {
    state.isMuted = !state.isMuted;
    if (this.currentAudio) {
      this.currentAudio.muted = state.isMuted;
    }
    ui.updateVolumeDisplay();
  },

  // 更新进度
  updateProgress() {
    if (this.currentAudio) {
      state.currentTime = this.currentAudio.currentTime;
      state.duration = this.currentAudio.duration || 0;
    }
    ui.updateProgressDisplay();
    if (state.lyricsPanelOpen) {
      ui.updateLyricsHighlight(state.currentTime);
    }
    ui.updatePlayerLyrics(state.currentTime);
  },
};

// 添加到播放历史
function addToPlayHistory(song) {
  // 确保 state.history 是一个数组
  if (!state.history || !Array.isArray(state.history)) {
    state.history = [];
  }

  // 检查是否已经存在这条历史记录
  const existing = state.history.filter((h) => h.id === song.id);

  // 如果不存在，添加到历史记录
  if (existing.length === 0) {
    // 获取当前时间戳
    const timestamp = Date.now();

    // 添加到历史记录
    state.history.push({
      id: song.id,
      title: song.title,
      artist: song.artist,
      timestamp: timestamp,
    });

    // 保存到本地存储
    saveHistoryToLocalStorage();
  }
}

// 添加性能监控
const performanceMonitor = {
  init() {
    if (performance.memory) {
      setInterval(() => {
        const memory = performance.memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        const totalMB = Math.round(memory.totalJSHeapSize / 1024 / 1024);
        if (usedMB > 100) {
          console.warn(`内存使用较高: ${usedMB}MB / ${totalMB}MB`);
        }
      }, 60000);
    }

    let frameCount = 0;
    let lastTime = performance.now();
    let lastWarnTime = 0;
    const warnCooldown = 60000; // 60秒冷却时间，减少警告频率
    const checkInterval = 30000; // 30秒检测间隔，减少检测频率
    const sampleInterval = 1000; // 1000ms采样间隔，减少性能影响

    const checkFPS = () => {
      // 仅在页面可见且应用不是静默状态时进行检测
      if (document.visibilityState === "visible" && !state.isBackground) {
        frameCount++;
        const now = performance.now();
        const elapsed = now - lastTime;

        if (elapsed >= checkInterval) {
          const fps = Math.round((frameCount * 1000) / elapsed);

          // 仅在FPS持续低于25且超过冷却时间才警告（提高阈值）
          if (fps < 25 && now - lastWarnTime > warnCooldown) {
            console.warn(`低帧率警告: ${fps} FPS`);
            
            // 添加性能建议
            console.info('性能优化建议:');
            console.info('1. 关闭不必要的浏览器标签页');
            console.info('2. 检查是否有扩展程序影响性能');
            console.info('3. 尝试减小音乐列表大小');
            console.info('4. 如问题持续，可考虑刷新页面');
            
            lastWarnTime = now;
          }

          frameCount = 0;
          lastTime = now;
        }
      }

      // 使用更长的采样间隔进一步减少性能影响
      setTimeout(checkFPS, sampleInterval);
    };

    // 初始化检测
    setTimeout(checkFPS, 100);
  },
};

// 在 script.js 中找到 safeArray 对象，修改为：

/**
 * 安全数组操作工具
 */
const safeArray = {
  filter(array, predicate) {
    if (!array) {
      console.warn("尝试对null/undefined数组进行filter操作");
      return [];
    }
    if (!Array.isArray(array)) {
      console.warn("尝试对非数组进行filter操作，返回空数组");
      return [];
    }
    return array.filter(predicate);
  },

  some(array, predicate) {
    if (!array || !Array.isArray(array)) {
      return false;
    }
    return array.some(predicate);
  },

  find(array, predicate) {
    if (!array || !Array.isArray(array)) {
      return undefined;
    }
    return array.find(predicate);
  },

  findIndex(array, predicate) {
    if (!array || !Array.isArray(array)) {
      return -1;
    }
    return array.findIndex(predicate);
  },

  map(array, predicate) {
    if (!array || !Array.isArray(array)) {
      return [];
    }
    return array.map(predicate);
  },

  slice(array, start, end) {
    if (!array || !Array.isArray(array)) {
      return [];
    }
    return array.slice(start, end);
  },
};

// 添加状态修复函数
function fixArrayState() {
  const arrayKeys = [
    "library",
    "favorites",
    "history",
    "dailyRecommendations",
    "featuredTracks",
  ];
  arrayKeys.forEach((key) => {
    if (!Array.isArray(state[key])) {
      console.warn(`修复 state.${key} 的数组状态`);
      state[key] = [];
    }
  });
}

// 增强的全局错误处理
window.addEventListener("error", (errorEvent) => {
  console.error("全局JavaScript错误:", errorEvent.error);
  console.error(
    "错误发生位置:",
    errorEvent.filename,
    "第",
    errorEvent.lineno,
    "行",
  );

  // 忽略音频相关错误
  if (
    errorEvent.error?.name === "NotSupportedError" ||
    errorEvent.error?.name === "NotAllowedError"
  ) {
    return;
  }

  // 检查是否是filter错误
  if (errorEvent.message && errorEvent.message.includes("filter")) {
    console.warn("数组filter错误，正在尝试修复...");
    // 尝试修复状态
    fixInitialState();
    fixArrayState();
  }

  utils.showError("应用错误", errorEvent.error?.message || "发生了未知错误");
});

window.addEventListener("unhandledrejection", (rejectionEvent) => {
  console.error("未处理的Promise拒绝:", rejectionEvent.reason);
  utils.showError("请求失败", rejectionEvent.reason?.message || "网络请求失败");
});

// 页面卸载清理
window.addEventListener("beforeunload", () => {
  player.cleanupCurrentAudio();
  wsManager.close();
  if (state.audioContext) {
    state.audioContext.close();
  }

  // 清理歌词滚动定时器
  if (state.lyricsScrollInterval) {
    clearInterval(state.lyricsScrollInterval);
    state.lyricsScrollInterval = null;
  }
});

// 添加页面隐藏/显示事件处理
document.addEventListener("visibilitychange", () => {
  state.pageVisible = !document.hidden;
  if (document.hidden) {
    // 页面隐藏时的处理
    console.log("页面已隐藏");
  } else {
    // 页面显示时的处理
    console.log("页面已显示");
    // 可以在这里重新建立WebSocket连接等
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      wsManager.connect();
    }
  }
});

// 定期内存清理
setInterval(
  () => {
    if (window.gc) window.gc();
    console.log("内存清理完成");
  },
  5 * 60 * 1000,
);

// 检查并修复初始状态
function fixInitialState() {
  if (!state.library || !Array.isArray(state.library)) {
    console.warn("state.library 未正确初始化，正在修复...");
    state.library = [];
  }
  if (!state.favorites || !Array.isArray(state.favorites)) {
    state.favorites = [];
  }
  if (!state.history || !Array.isArray(state.history)) {
    state.history = [];
  }
  if (
    !state.dailyRecommendations ||
    !Array.isArray(state.dailyRecommendations)
  ) {
    state.dailyRecommendations = [];
  }
  if (!state.featuredTracks || !Array.isArray(state.featuredTracks)) {
    state.featuredTracks = [];
  }
}

// 在 DOM 加载完成后执行修复
// 初始化错误恢复策略
function initErrorRecoveryStrategies() {
  // 网络错误恢复策略
  errorHandler.registerRecoveryStrategy('NETWORK_ERROR', async (errorInfo) => {
    networkManager.isOnline = navigator.onLine;
    
    if (!networkManager.isOnline) {
      return false; // 网络离线时无法恢复
    }
    
    // 等待网络恢复
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (navigator.onLine) {
          clearInterval(checkInterval);
          
          // 尝试重新连接WebSocket
          wsManager.connect();
          
          // 重新加载音乐数据
          musicManager.loadMusicData().then(() => {
            resolve(true);
          }).catch(() => {
            resolve(false);
          });
        }
      }, 2000);
      
      // 最多等待30秒
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 30000);
    });
  });
  
  // 解析错误恢复策略
  errorHandler.registerRecoveryStrategy('PARSE_ERROR', async (errorInfo) => {
    // 尝试清除缓存并重新加载数据
    musicManager.clearCache();
    return musicManager.loadMusicData().then(() => true).catch(() => false);
  });
  
  // 超时错误恢复策略
  errorHandler.registerRecoveryStrategy('TIMEOUT_ERROR', async (errorInfo) => {
    // 增加重试次数
    networkManager.retryCount = 0;
    
    // 重新发起请求
    if (errorInfo.context && errorInfo.context.apiCall) {
      try {
        await errorInfo.context.apiCall();
        return true;
      } catch (err) {
        console.error('重试API调用失败:', err);
        return false;
      }
    }
    
    return false;
  });
}

// 全局错误处理
window.addEventListener('error', (event) => {
  errorHandler.logError(event.error || new Error(event.message), {
    type: 'JAVASCRIPT_ERROR',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

// 未捕获的Promise拒绝
window.addEventListener('unhandledrejection', (event) => {
  errorHandler.logError(new Error(event.reason), {
    type: 'UNHANDLED_PROMISE_REJECTION',
    promise: event.promise
  });
  
  // 防止错误在控制台显示
  event.preventDefault();
});

document.addEventListener("DOMContentLoaded", () => {
  try {
    // 初始化错误处理
    initErrorRecoveryStrategies();
    
    // 捕获初始化错误
    fixInitialState(); // 先修复状态
    loadingManager.show("正在初始化应用...");
    performanceMonitor.init();
    
    // 初始化网络管理器
    networkManager.init();
    
    setTimeout(() => {
      ui.init();
      setTimeout(() => loadingManager.hide(), 500);
    }, 100);
  } catch (error) {
    errorHandler.logError(error, {
      type: 'INITIALIZATION_ERROR'
    });
    loadingManager.hide();
    utils.showError("初始化失败", "应用初始化失败，请刷新页面重试");
  }
});

function loadHistoryFromLocalStorage() {
  const historyData = localStorage.getItem("playHistory");
  if (historyData) {
    state.history = JSON.parse(historyData);
  } else {
    state.history = [];
  }
}

// 工具函数
// ✅ 使用防抖
const handleSearch = utils.debounce((event) => {
  // 执行搜索逻辑
  api.searchMusic(event.target.value);
}, CONFIG.SEARCH_DEBOUNCE_MS || 300); // 从配置中读取延迟，默认300ms

dom.searchInput.addEventListener("input", handleSearch);
