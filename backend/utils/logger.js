const fs = require("fs");
const path = require("path");

// 日志级别
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// 颜色编码
const COLORS = {
  RESET: "\x1b[0m",
  DEBUG: "\x1b[36m", // 青色
  INFO: "\x1b[32m", // 绿色
  WARN: "\x1b[33m", // 黄色
  ERROR: "\x1b[31m", // 红色
  TIMESTAMP: "\x1b[35m", // 紫色
  CATEGORY: "\x1b[34m", // 蓝色
};

// 日志配置
const LOG_CONFIG = {
  level: process.env.LOG_LEVEL || "INFO",
  enableColors: process.env.NODE_ENV !== "production",
  enableFileLogging: true,
  logDirectory: path.resolve(__dirname, "../logs"),
  logFileName: "server.log",
};

// 创建日志目录
if (LOG_CONFIG.enableFileLogging) {
  try {
    if (!fs.existsSync(LOG_CONFIG.logDirectory)) {
      fs.mkdirSync(LOG_CONFIG.logDirectory, { recursive: true });
    }
  } catch (error) {
    console.error("❌ 创建日志目录失败:", error);
    LOG_CONFIG.enableFileLogging = false;
  }
}

class Logger {
  constructor(category = "DEFAULT") {
    this.category = category;
  }

  /**
   * 获取当前时间戳
   */
  _getTimestamp() {
    const now = new Date();
    return now.toISOString().replace("T", " ").substring(0, 23);
  }

  /**
   * 写入日志到文件
   */
  _writeToFile(level, message) {
    if (!LOG_CONFIG.enableFileLogging) return;

    const timestamp = this._getTimestamp();
    const logEntry = `[${timestamp}] [${level}] [${this.category}] ${message}\n`;
    const logPath = path.join(LOG_CONFIG.logDirectory, LOG_CONFIG.logFileName);

    try {
      fs.appendFileSync(logPath, logEntry, "utf8");
    } catch (error) {
      console.error("❌ 写入日志文件失败:", error);
      LOG_CONFIG.enableFileLogging = false;
    }
  }

  /**
   * 格式化日志消息
   */
  _formatMessage(level, message, error) {
    const timestamp = this._getTimestamp();
    const levelStr = level.padEnd(5, " ");
    const category = this.category.padEnd(15, " ");

    let logMessage = `${timestamp} [${levelStr}] [${category}] ${message}`;
    if (error) {
      logMessage += `\n${error.stack || error.message}`;
    }

    return logMessage;
  }

  /**
   * 带颜色的日志输出
   */
  _logWithColor(level, message, error) {
    if (!LOG_CONFIG.enableColors) {
      console[level.toLowerCase()](this._formatMessage(level, message, error));
      return;
    }

    const timestamp = this._getTimestamp();
    const levelStr = level.padEnd(5, " ");
    const category = this.category.padEnd(15, " ");

    const color = COLORS[level] || COLORS.RESET;
    const logMessage = `${COLORS.TIMESTAMP}[${timestamp}]${COLORS.RESET} ${color}[${levelStr}]${COLORS.RESET} ${COLORS.CATEGORY}[${category}]${COLORS.RESET} ${message}`;

    if (error) {
      console[level.toLowerCase()](logMessage);
      console[level.toLowerCase()](
        `${COLORS.ERROR}${error.stack || error.message}${COLORS.RESET}`,
      );
    } else {
      console[level.toLowerCase()](logMessage);
    }
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  _shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[LOG_CONFIG.level];
  }

  /**
   * 调试日志
   */
  debug(message) {
    if (!this._shouldLog("DEBUG")) return;
    this._logWithColor("DEBUG", message);
    this._writeToFile("DEBUG", message);
  }

  /**
   * 信息日志
   */
  info(message) {
    if (!this._shouldLog("INFO")) return;
    this._logWithColor("INFO", message);
    this._writeToFile("INFO", message);
  }

  /**
   * 警告日志
   */
  warn(message, error) {
    if (!this._shouldLog("WARN")) return;
    this._logWithColor("WARN", message, error);
    this._writeToFile("WARN", message + (error ? ` - ${error.message}` : ""));
  }

  /**
   * 错误日志
   */
  error(message, error) {
    if (!this._shouldLog("ERROR")) return;
    this._logWithColor("ERROR", message, error);
    this._writeToFile("ERROR", message + (error ? ` - ${error.message}` : ""));
  }
}

// 导出单例和工厂方法
module.exports = {
  Logger,
  getLogger: (category) => new Logger(category),
};
