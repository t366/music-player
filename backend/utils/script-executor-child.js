const vm = require("vm");
const fs = require("fs");

/**
 * 子进程：安全执行音乐源脚本
 */
function main() {
  let inputData = "";

  // 从stdin读取输入数据
  process.stdin.on("data", (chunk) => {
    inputData += chunk.toString();
  });

  process.stdin.on("end", () => {
    try {
      const { content, filename } = JSON.parse(inputData);
      const timeout = parseInt(process.env.SCRIPT_TIMEOUT || "60000");

      // 创建沙箱环境
      const sandbox = createSandbox();

      // 创建执行上下文
      vm.createContext(sandbox);

      // 初始化执行步骤计数器
      let executionSteps = 0;
      const maxSteps = 1000000; // 最大执行步骤，防止无限循环

      // 重写console方法以跟踪执行步骤
      const originalConsole = console;
      sandbox.console = {
        ...originalConsole,
        log: function (...args) {
          executionSteps++;
          if (executionSteps > maxSteps) {
            throw new Error(
              `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
            );
          }
          originalConsole.log(...args);
        },
        debug: function (...args) {
          executionSteps++;
          if (executionSteps > maxSteps) {
            throw new Error(
              `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
            );
          }
          originalConsole.debug(...args);
        },
        info: function (...args) {
          executionSteps++;
          if (executionSteps > maxSteps) {
            throw new Error(
              `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
            );
          }
          originalConsole.info(...args);
        },
        warn: function (...args) {
          executionSteps++;
          if (executionSteps > maxSteps) {
            throw new Error(
              `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
            );
          }
          originalConsole.warn(...args);
        },
        error: function (...args) {
          executionSteps++;
          if (executionSteps > maxSteps) {
            throw new Error(
              `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
            );
          }
          originalConsole.error(...args);
        },
      };

      // 定期检查执行步骤，即使没有console输出
      const stepCheckInterval = setInterval(() => {
        executionSteps++;
        if (executionSteps > maxSteps) {
          clearInterval(stepCheckInterval);
          throw new Error(
            `执行步骤超过最大限制 (${maxSteps})，可能存在无限循环`,
          );
        }
      }, 100); // 每100毫秒增加一个步骤计数

      try {
        // 测试沙箱环境
        console.error("子进程：开始测试沙箱环境...");
        const testScript = new vm.Script(
          "const testArray = Array.from([1, 2, 3]); const testResult = { success: true, array: testArray };",
          { displayErrors: true },
        );
        testScript.runInContext(sandbox, { timeout: 1000 });
        console.error(
          "子进程：沙箱环境测试成功，测试结果:",
          JSON.stringify(sandbox.testResult),
        );

        // 增强沙箱环境：在执行音乐源脚本之前，确保Array.from在全局作用域中可用
        console.error("子进程：增强沙箱环境...");

        // 直接在沙箱对象上设置，而不是通过VM脚本
        // 确保Array构造函数可用
        if (typeof sandbox.Array === "undefined") {
          sandbox.Array = Array;
        }

        // 确保Array.from可用
        if (typeof sandbox.Array.from === "undefined") {
          sandbox.Array.from = Array.from;
        }

        // 将Array.from绑定到全局作用域作为备选
        sandbox.from = Array.from;
        sandbox.arrayFrom = Array.from;

        // 确保Array.prototype完整
        if (typeof sandbox.Array.prototype === "undefined") {
          sandbox.Array.prototype = Array.prototype;
        }

        // 另外，确保全局对象上也有Array和Array.from
        sandbox.global.Array = sandbox.Array;
        sandbox.global.Array.from = sandbox.Array.from;
        sandbox.global.from = sandbox.from;
        sandbox.global.arrayFrom = sandbox.arrayFrom;

        console.error("子进程：沙箱环境增强完成");
        console.error(
          "子进程：Array.from在沙箱中可用吗？",
          typeof sandbox.Array.from === "function",
        );
        console.error(
          "子进程：Array.from在全局沙箱中可用吗？",
          typeof sandbox.global.Array.from === "function",
        );
        console.error(
          "子进程：备选from函数可用吗？",
          typeof sandbox.from === "function",
        );

        // 执行音乐源脚本
        console.error("子进程：开始执行音乐源脚本...");
        console.error("子进程：脚本内容长度:", content.length, "字符");

        // 在脚本开头注入确保Array.from可用的代码 - 更安全的注入方式
        const enhancedContent =
          `
                    // 在沙箱中直接使用预注入的Array.from引用
                    var Array = this.Array;
                    
                    // 确保Array.from存在
                    if (typeof Array.from === 'undefined') {
                        Array.from = this.from;
                    }
                    
                    // 将Array.from绑定到多个变量名，确保脚本能找到它
                    var from = Array.from;
                    var arrayFrom = Array.from;
                    var __Array_from = Array.from;
                    var Array_from = Array.from;
                    
                    // 确保在所有全局对象上都有
                    if (typeof global !== 'undefined') {
                        global.Array = Array;
                        global.Array.from = Array.from;
                        global.from = from;
                        global.arrayFrom = arrayFrom;
                        global.__Array_from = __Array_from;
                        global.Array_from = Array_from;
                    }
                    if (typeof window !== 'undefined') {
                        window.Array = Array;
                        window.Array.from = Array.from;
                        window.from = from;
                        window.arrayFrom = arrayFrom;
                        window.__Array_from = __Array_from;
                        window.Array_from = Array_from;
                    }
                    if (typeof self !== 'undefined') {
                        self.Array = Array;
                        self.Array.from = Array.from;
                        self.from = from;
                        self.arrayFrom = arrayFrom;
                        self.__Array_from = __Array_from;
                        self.Array_from = Array_from;
                    }
                    if (typeof globalThis !== 'undefined') {
                        globalThis.Array = Array;
                        globalThis.Array.from = Array.from;
                        globalThis.from = from;
                        globalThis.arrayFrom = arrayFrom;
                        globalThis.__Array_from = __Array_from;
                        globalThis.Array_from = Array_from;
                    }
                    if (typeof this !== 'undefined') {
                        this.Array = Array;
                        this.Array.from = Array.from;
                        this.from = from;
                        this.arrayFrom = arrayFrom;
                        this.__Array_from = __Array_from;
                        this.Array_from = Array_from;
                    }
                ` + content;

        console.error(
          "子进程：脚本内容增强完成，增强后长度:",
          enhancedContent.length,
          "字符",
        );

        const script = new vm.Script(enhancedContent, { displayErrors: true });
        console.error("子进程：脚本对象创建成功");

        const startTime = Date.now();
        console.error("子进程：开始执行脚本 (超时设置:", timeout, "毫秒)...");

        script.runInContext(sandbox, {
          timeout: timeout,
          displayErrors: true,
          breakOnSigint: true,
        });

        const endTime = Date.now();
        console.error(
          "子进程：脚本执行成功，耗时:",
          endTime - startTime,
          "毫秒",
        );
        console.error("子进程：总执行步骤:", executionSteps);

        clearInterval(stepCheckInterval);

        // 提取歌曲数据
        const songs = extractSongsData(sandbox);

        // 调试：打印沙箱中所有可枚举变量
        console.error("子进程：沙箱中所有可枚举变量：");
        for (const key in sandbox) {
          if (sandbox.hasOwnProperty(key)) {
            const value = sandbox[key];
            console.error("  " + key + ": " + typeof value);
            if (typeof value === "object" && value !== null) {
              console.error(
                "    键：",
                Object.keys(value).slice(0, 10).join(", ") +
                  (Object.keys(value).length > 10 ? "..." : ""),
              );
            }
          }
        }

        // 返回成功结果
        const result = {
          success: true,
          songs: songs,
          executionTime: endTime - startTime,
          executionSteps: executionSteps,
          sandboxVariables: getImportantSandboxVariables(sandbox),
          // 添加更多调试信息
          debug: {
            allVariables: Object.keys(sandbox),
            moduleExports: sandbox.module ? sandbox.module.exports : null,
            lxStructure: sandbox.lx
              ? {
                  keys: Object.keys(sandbox.lx),
                  hasApi: !!sandbox.lx.api,
                  hasData: !!sandbox.lx.data,
                  hasUtils: !!sandbox.lx.utils,
                }
              : null,
          },
        };

        process.stdout.write(JSON.stringify(result));
      } catch (executionError) {
        clearInterval(stepCheckInterval);
        console.error("子进程：脚本执行错误:", executionError);

        // 返回错误结果
        const result = {
          success: false,
          error: {
            name: executionError.name,
            message: executionError.message,
            stack: executionError.stack,
            code: executionError.code,
          },
          executionSteps: executionSteps,
        };

        process.stdout.write(JSON.stringify(result));
      }
    } catch (parseError) {
      console.error("子进程：输入数据解析错误:", parseError);

      // 返回解析错误
      const result = {
        success: false,
        error: {
          name: "ParseError",
          message: "输入数据解析失败",
          stack: parseError.stack,
        },
      };

      process.stdout.write(JSON.stringify(result));
    }
  });
}

/**
 * 创建安全的沙箱环境
 * @returns {object} 沙箱对象
 */
function createSandbox() {
  const sandbox = {};

  // 设置全局指向
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  // lx对象 - 音乐源脚本通常需要
  sandbox.lx = {
    EVENT_NAMES: {
      qualitychange: "qualitychange",
      musicSource: {
        get: "MUSIC_SOURCE_GET",
        search: "MUSIC_SOURCE_SEARCH",
      },
    },
    request: Object.assign(
      function (options, callback) {
        if (typeof callback === "function") {
          callback(null, {
            statusCode: 200,
            data: { info: { url: "", data: "" } },
          });
        } else {
          return Promise.resolve({
            statusCode: 200,
            data: { info: { url: "", data: "" } },
          });
        }
      },
      {
        get: (url, options, callback) => {
          if (typeof callback === "function") {
            callback(null, {
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          } else {
            return Promise.resolve({
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          }
        },
        post: (url, options, callback) => {
          if (typeof callback === "function") {
            callback(null, {
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          } else {
            return Promise.resolve({
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          }
        },
        request: (options, callback) => {
          if (typeof callback === "function") {
            callback(null, {
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          } else {
            return Promise.resolve({
              statusCode: 200,
              data: { info: { url: "", data: "" } },
            });
          }
        },
      },
    ),
    on: (event, callback) => {},
    send: (event, data) => {},
    env: {
      platform: "node",
      version: "1.0.0",
    },
    version: "1.0.0",
    currentScriptInfo: {
      id: "imported-source",
      name: "music-source.js",
      type: "music",
    },
    utils: {
      isArray: Array.isArray,
      isObject: (obj) =>
        typeof obj === "object" && obj !== null && !Array.isArray(obj),
      isString: (str) => typeof str === "string",
      isNumber: (num) => typeof num === "number",
      isFunction: (func) => typeof func === "function",
      decodeHTMLEntities: (str) => str,
      encodeHTMLEntities: (str) => str,
      base64Encode: (str) => Buffer.from(str).toString("base64"),
      base64Decode: (str) => Buffer.from(str, "base64").toString(),
    },
  };

  // 模块导出
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  sandbox.export = {};

  // 常用对象
  sandbox.document = {};
  sandbox.navigator = {};
  sandbox.location = {};

  // 网络相关对象
  sandbox.Headers =
    Headers ||
    function () {
      return {};
    };
  sandbox.Request =
    Request ||
    function () {
      return {};
    };
  sandbox.Response =
    Response ||
    function () {
      return {};
    };

  // 定时函数
  sandbox.setTimeout = setTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearTimeout = clearTimeout;
  sandbox.clearInterval = clearInterval;

  // 核心内置对象和方法 - 使用Proxy保护核心对象不被修改

  // 完全重写Array对象，确保它始终包含from方法
  function createProtectedArray() {
    // 先保存原始Array对象！
    const originalArray = Array;

    // 创建一个新的Array构造函数
    function Array(...args) {
      if (args.length === 1 && typeof args[0] === "number") {
        return new originalArray(args[0]);
      }
      return originalArray.apply(this, args);
    }

    // 复制原始Array的原型方法
    Array.prototype = originalArray.prototype;

    // 设置静态方法，直接绑定到原始方法
    Array.from =
      originalArray.from ||
      function (arrayLike, mapFn, thisArg) {
        // 更加健壮的Array.from实现
        if (arrayLike == null) {
          throw new TypeError("Array.from requires an array-like object");
        }

        const items = [];
        const length = arrayLike.length >>> 0; // 转换为无符号32位整数

        for (let i = 0; i < length; i++) {
          if (i in arrayLike) {
            // 检查属性是否存在
            const item = arrayLike[i];
            items.push(mapFn ? mapFn.call(thisArg, item, i) : item);
          }
        }
        return items;
      };

    // 为那些可能没有Array.from的环境提供额外保障
    if (typeof Array.from !== "function") {
      Array.from = function (arrayLike, mapFn, thisArg) {
        if (arrayLike == null) {
          throw new TypeError("Array.from requires an array-like object");
        }

        const items = [];
        const length = arrayLike.length >>> 0;

        for (let i = 0; i < length; i++) {
          if (i in arrayLike) {
            const item = arrayLike[i];
            items.push(mapFn ? mapFn.call(thisArg, item, i) : item);
          }
        }
        return items;
      };
    }
    Array.isArray =
      originalArray.isArray ||
      function (obj) {
        return Object.prototype.toString.call(obj) === "[object Array]";
      };

    Array.of =
      originalArray.of ||
      function (...args) {
        const result = [];
        for (let i = 0; i < args.length; i++) {
          result[i] = args[i];
        }
        return result;
      };

    return Array;
  }

  // 创建并设置受保护的Array对象
  const protectedArray = createProtectedArray();
  sandbox.Array = new Proxy(protectedArray, {
    get: function (target, prop, receiver) {
      // 确保from方法始终可用，即使被修改
      if (prop === "from") {
        return Array.from;
      }
      if (prop === "isArray") {
        return Array.isArray;
      }
      if (prop === "of") {
        return Array.of;
      }
      return target[prop];
    },
    set: function (target, prop, value, receiver) {
      // 禁止修改Array的核心方法
      if (["from", "isArray", "of"].includes(prop)) {
        return false;
      }
      // 允许修改其他属性
      target[prop] = value;
      return true;
    },
    deleteProperty: function (target, prop) {
      // 禁止删除Array的核心方法
      if (["from", "isArray", "of"].includes(prop)) {
        return false;
      }
      // 允许删除其他属性
      delete target[prop];
      return true;
    },
  });

  // 直接将Array的核心方法注入到沙箱中，作为备选方案
  sandbox.Array_from = Array.from;
  sandbox.Array_isArray = Array.isArray;
  sandbox.Array_of = Array.of;
  // 添加更多别名以提高兼容性
  sandbox.from = Array.from;
  sandbox.__from = Array.from;
  sandbox.arrayFrom = Array.from;

  // 确保Array.prototype完整 - 直接使用原始的Array.prototype
  // 不尝试替换它，因为它是一个非可配置和非可写的数据属性
  sandbox.Array.prototype = Array.prototype;

  // 为Object创建一个受保护的代理
  const protectedObject = Object;
  sandbox.Object = new Proxy(protectedObject, {
    get: function (target, prop, receiver) {
      if (prop === "assign" && typeof target.assign === "undefined") {
        return Object.assign;
      }
      if (prop === "create" && typeof target.create === "undefined") {
        return Object.create;
      }
      if (prop === "keys" && typeof target.keys === "undefined") {
        return Object.keys;
      }
      if (prop === "values" && typeof target.values === "undefined") {
        return Object.values;
      }
      if (prop === "entries" && typeof target.entries === "undefined") {
        return Object.entries;
      }
      if (
        prop === "defineProperty" &&
        typeof target.defineProperty === "undefined"
      ) {
        return Object.defineProperty;
      }
      return target[prop];
    },
    set: function (target, prop, value, receiver) {
      // 禁止修改Object的核心方法
      if (
        [
          "assign",
          "create",
          "keys",
          "values",
          "entries",
          "defineProperty",
        ].includes(prop)
      ) {
        return false;
      }
      // 允许修改其他属性
      target[prop] = value;
      return true;
    },
    deleteProperty: function (target, prop) {
      // 禁止删除Object的核心方法
      if (
        [
          "assign",
          "create",
          "keys",
          "values",
          "entries",
          "defineProperty",
        ].includes(prop)
      ) {
        return false;
      }
      // 允许删除其他属性
      delete target[prop];
      return true;
    },
  });

  // 直接将Object的核心方法注入到沙箱中，作为备选方案
  sandbox.Object_assign = Object.assign;
  sandbox.Object_create = Object.create;
  sandbox.Object_keys = Object.keys;
  sandbox.Object_values = Object.values;
  sandbox.Object_entries = Object.entries;

  // 其他核心对象
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

  // 确保Array.prototype上的所有方法都可用且不可修改
  const arrayPrototypeMethods = [
    "forEach",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "find",
    "findIndex",
    "some",
    "every",
    "includes",
    "indexOf",
    "lastIndexOf",
    "join",
    "slice",
    "concat",
    "push",
    "pop",
    "shift",
    "unshift",
    "sort",
    "reverse",
    "splice",
    "toString",
    "toLocaleString",
    "length",
  ];
  arrayPrototypeMethods.forEach((method) => {
    if (typeof Array.prototype[method] === "function") {
      Object.defineProperty(sandbox.Array.prototype, method, {
        value: Array.prototype[method],
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
  });

  // 确保String的所有方法可用
  for (const method in String) {
    if (typeof String[method] === "function") {
      sandbox.String[method] = String[method];
    }
  }

  // 确保Number的所有方法可用
  for (const method in Number) {
    if (typeof Number[method] === "function") {
      sandbox.Number[method] = Number[method];
    }
  }

  // 确保Boolean的所有方法可用
  for (const method in Boolean) {
    if (typeof Boolean[method] === "function") {
      sandbox.Boolean[method] = Boolean[method];
    }
  }

  // 其他工具函数
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

  return sandbox;
}

/**
 * 从沙箱中提取歌曲数据
 * @param {object} sandbox - 沙箱环境
 * @returns {Array} 歌曲数组
 */
function extractSongsData(sandbox) {
  // 可能的歌曲变量名（增加更多可能性）
  const possibleVariables = [
    "songs",
    "music",
    "tracks",
    "playlist",
    "song",
    "list",
    "data",
    "result",
    "s",
    "m",
    "items",
    "contents",
    "songList",
    "musicList",
    "trackList",
    "playList",
    "song_data",
    "music_data",
    "track_data",
    "song_list",
    "music_list",
    "track_list",
    "playlist_data",
    "results",
    "returnValue",
    "value",
    "output",
    "response",
    "content",
    "info",
    "body",
    "dataList",
    "datalist",
    "songdata",
    "musicdata",
    "trackdata",
    "song_data",
    "music_data",
    "track_data",
    "song_info",
    "music_info",
    "track_info",
    "songInfo",
    "musicInfo",
    "trackInfo",
    "item",
    "itemsList",
    "items_list",
    "listItems",
    "list_items",
    "listItem",
    "list_item",
    "dataItem",
    "data_item",
    "infoItem",
    "info_item",
    "resultItem",
    "result_item",
    "trackItem",
    "track_item",
    "musicItem",
    "music_item",
    "songItem",
    "song_item",
    "array",
    "items_array",
    "data_array",
    "result_array",
    "array_items",
    "array_data",
    "array_result",
    "arr",
    "arrayList",
    "array_list",
    "listArray",
    "list_array",
    "songsArray",
    "songs_array",
    "musicArray",
    "music_array",
    "tracksArray",
    "tracks_array",
    "playlistArray",
    "playlist_array",
  ];

  // 1. 检查直接变量
  for (const varName of possibleVariables) {
    if (Array.isArray(sandbox[varName])) {
      console.log(
        "子进程：在变量",
        varName,
        "中找到歌曲数组，长度:",
        sandbox[varName].length,
      );
      return sandbox[varName];
    }
  }

  // 2. 检查 module.exports
  if (sandbox.module && sandbox.module.exports) {
    if (Array.isArray(sandbox.module.exports)) {
      console.log(
        "子进程：在 module.exports 中找到歌曲数组，长度:",
        sandbox.module.exports.length,
      );
      return sandbox.module.exports;
    }

    for (const varName of possibleVariables) {
      if (Array.isArray(sandbox.module.exports[varName])) {
        console.log(
          "子进程：在 module.exports.",
          varName,
          "中找到歌曲数组，长度:",
          sandbox.module.exports[varName].length,
        );
        return sandbox.module.exports[varName];
      }
    }

    // 检查 module.exports 的其他属性
    const moduleKeys = Object.keys(sandbox.module.exports);
    for (const key of moduleKeys) {
      const value = sandbox.module.exports[key];
      if (typeof value === "object" && value !== null) {
        // 检查对象中的可能变量
        for (const varName of possibleVariables) {
          if (Array.isArray(value[varName])) {
            console.log(
              "子进程：在 module.exports.",
              key,
              ".",
              varName,
              "中找到歌曲数组，长度:",
              value[varName].length,
            );
            return value[varName];
          }
        }

        // 检查对象是否为数组（直接检查）
        if (Array.isArray(value)) {
          if (isSongArray(value)) {
            console.log(
              "子进程：在 module.exports.",
              key,
              "中找到疑似歌曲数组，长度:",
              value.length,
            );
            return value;
          }
        }
      }
    }
  }

  // 3. 检查 lx 对象（更深入）
  if (sandbox.lx && typeof sandbox.lx === "object") {
    for (const varName of possibleVariables) {
      if (Array.isArray(sandbox.lx[varName])) {
        console.log(
          "子进程：在 lx.",
          varName,
          "中找到歌曲数组，长度:",
          sandbox.lx[varName].length,
        );
        return sandbox.lx[varName];
      }
    }

    // 检查 lx 的所有属性
    const lxKeys = Object.keys(sandbox.lx);
    for (const key of lxKeys) {
      const value = sandbox.lx[key];
      if (typeof value === "object" && value !== null) {
        // 递归检查 lx 的属性
        const result = deepSearchForSongs(value, "lx." + key);
        if (result) return result;
      }
    }
  }

  // 4. 检查沙箱中的所有变量（包括不常见的）
  const allKeys = Object.keys(sandbox);
  console.log("子进程：检查沙箱中的所有", allKeys.length, "个变量...");

  for (const key of allKeys) {
    const value = sandbox[key];
    if (typeof value === "object" && value !== null) {
      // 递归检查沙箱中的所有对象
      const result = deepSearchForSongs(value, key);
      if (result) return result;
    }
  }

  // 5. 检查所有数组变量（更宽松的条件）
  const arrayKeys = allKeys.filter((key) => Array.isArray(sandbox[key]));
  console.log(
    "子进程：在沙箱中找到",
    arrayKeys.length,
    "个数组变量:",
    arrayKeys,
  );

  // 检查每个数组
  for (const key of arrayKeys) {
    const array = sandbox[key];
    console.log("子进程：数组变量", key, "长度:", array.length);

    if (array.length > 0) {
      // 记录所有非空数组的详细信息
      for (let i = 0; i < Math.min(array.length, 2); i++) {
        const item = array[i];
        let itemInfo = typeof item;
        if (typeof item === "object" && item !== null) {
          const keys = Object.keys(item);
          itemInfo +=
            " (keys: " +
            keys.slice(0, 10).join(", ") +
            (keys.length > 10 ? "..." : "") +
            ")";

          // 检查是否包含歌曲相关属性
          const songProps = [
            "title",
            "name",
            "artist",
            "singer",
            "url",
            "file_url",
            "src",
            "id",
          ];
          const hasSongProps = songProps.some((prop) => prop in item);
          if (hasSongProps) {
            console.log(
              "子进程：数组",
              key,
              "元素",
              i,
              "包含歌曲属性:",
              songProps.filter((prop) => prop in item),
            );
          }
        }
        console.log("子进程：数组", key, "元素", i, "类型:", itemInfo);
      }

      if (isSongArray(array)) {
        console.log(
          "子进程：在变量",
          key,
          "中发现疑似歌曲数组，长度:",
          array.length,
        );
        return array;
      }
    }
  }

  // 6. 检查 lx 对象中的所有数组（更深入）
  if (sandbox.lx && typeof sandbox.lx === "object") {
    const lxArrayKeys = Object.keys(sandbox.lx).filter((key) =>
      Array.isArray(sandbox.lx[key]),
    );
    console.log(
      "子进程：在 lx 对象中找到",
      lxArrayKeys.length,
      "个数组变量:",
      lxArrayKeys,
    );

    for (const key of lxArrayKeys) {
      const array = sandbox.lx[key];
      console.log("子进程：lx.", key, "数组长度:", array.length);

      if (array.length > 0) {
        // 记录前2个元素的详细信息
        for (let i = 0; i < Math.min(array.length, 2); i++) {
          const item = array[i];
          let itemInfo = typeof item;
          if (typeof item === "object" && item !== null) {
            const keys = Object.keys(item);
            itemInfo +=
              " (keys: " +
              keys.slice(0, 10).join(", ") +
              (keys.length > 10 ? "..." : "") +
              ")";

            // 检查是否包含歌曲相关属性
            const songProps = [
              "title",
              "name",
              "artist",
              "singer",
              "url",
              "file_url",
              "src",
              "id",
            ];
            const hasSongProps = songProps.some((prop) => prop in item);
            if (hasSongProps) {
              console.log(
                "子进程：lx.",
                key,
                "数组元素",
                i,
                "包含歌曲属性:",
                songProps.filter((prop) => prop in item),
              );
            }
          }
          console.log("子进程：lx.", key, "数组元素", i, "类型:", itemInfo);
        }

        if (isSongArray(array)) {
          console.log(
            "子进程：在 lx.",
            key,
            "中发现疑似歌曲数组，长度:",
            array.length,
          );
          return array;
        }
      }
    }
  }

  // 7. 检查 module.exports 中的所有数组（更深入）
  if (
    sandbox.module &&
    sandbox.module.exports &&
    typeof sandbox.module.exports === "object"
  ) {
    const moduleArrayKeys = Object.keys(sandbox.module.exports).filter((key) =>
      Array.isArray(sandbox.module.exports[key]),
    );
    console.log(
      "子进程：在 module.exports 中找到",
      moduleArrayKeys.length,
      "个数组变量:",
      moduleArrayKeys,
    );

    for (const key of moduleArrayKeys) {
      const array = sandbox.module.exports[key];
      console.log("子进程：module.exports.", key, "数组长度:", array.length);

      if (array.length > 0) {
        // 记录前2个元素的详细信息
        for (let i = 0; i < Math.min(array.length, 2); i++) {
          const item = array[i];
          let itemInfo = typeof item;
          if (typeof item === "object" && item !== null) {
            const keys = Object.keys(item);
            itemInfo +=
              " (keys: " +
              keys.slice(0, 10).join(", ") +
              (keys.length > 10 ? "..." : "") +
              ")";

            // 检查是否包含歌曲相关属性
            const songProps = [
              "title",
              "name",
              "artist",
              "singer",
              "url",
              "file_url",
              "src",
              "id",
            ];
            const hasSongProps = songProps.some((prop) => prop in item);
            if (hasSongProps) {
              console.log(
                "子进程：module.exports.",
                key,
                "数组元素",
                i,
                "包含歌曲属性:",
                songProps.filter((prop) => prop in item),
              );
            }
          }
          console.log(
            "子进程：module.exports.",
            key,
            "数组元素",
            i,
            "类型:",
            itemInfo,
          );
        }

        if (isSongArray(array)) {
          console.log(
            "子进程：在 module.exports.",
            key,
            "中发现疑似歌曲数组，长度:",
            array.length,
          );
          return array;
        }
      }
    }
  }

  console.log("子进程：未找到歌曲数据");
  return [];
}

/**
 * 递归搜索对象中的歌曲数据
 * @param {object} obj - 要搜索的对象
 * @param {string} path - 当前搜索路径（用于日志）
 * @returns {Array|null} 找到的歌曲数组或null
 */
function deepSearchForSongs(obj, path) {
  // 可能的歌曲变量名（与extractSongsData使用相同的全面列表）
  const possibleVariables = [
    "songs",
    "music",
    "tracks",
    "playlist",
    "song",
    "list",
    "data",
    "result",
    "s",
    "m",
    "items",
    "contents",
    "songList",
    "musicList",
    "trackList",
    "playList",
    "song_data",
    "music_data",
    "track_data",
    "song_list",
    "music_list",
    "track_list",
    "playlist_data",
    "results",
    "returnValue",
    "value",
    "output",
    "response",
    "content",
    "info",
    "body",
    "dataList",
    "datalist",
    "songdata",
    "musicdata",
    "trackdata",
    "song_data",
    "music_data",
    "track_data",
    "song_info",
    "music_info",
    "track_info",
    "songInfo",
    "musicInfo",
    "trackInfo",
    "item",
    "itemsList",
    "items_list",
    "listItems",
    "list_items",
    "listItem",
    "list_item",
    "dataItem",
    "data_item",
    "infoItem",
    "info_item",
    "resultItem",
    "result_item",
    "trackItem",
    "track_item",
    "musicItem",
    "music_item",
    "songItem",
    "song_item",
    "array",
    "items_array",
    "data_array",
    "result_array",
    "array_items",
    "array_data",
    "array_result",
    "arr",
    "arrayList",
    "array_list",
    "listArray",
    "list_array",
    "songsArray",
    "songs_array",
    "musicArray",
    "music_array",
    "tracksArray",
    "tracks_array",
    "playlistArray",
    "playlist_array",
  ];

  // 检查对象本身是否为数组
  if (Array.isArray(obj)) {
    if (isSongArray(obj)) {
      console.log("子进程：在", path, "中发现疑似歌曲数组，长度:", obj.length);
      return obj;
    }
  }

  // 检查对象的属性
  if (typeof obj === "object" && obj !== null) {
    const keys = Object.keys(obj);

    // 检查可能的歌曲变量名
    for (const varName of possibleVariables) {
      if (keys.includes(varName) && Array.isArray(obj[varName])) {
        console.log(
          "子进程：在",
          path + "." + varName,
          "中找到歌曲数组，长度:",
          obj[varName].length,
        );
        return obj[varName];
      }
    }

    // 递归检查所有属性
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "object" && value !== null) {
        const result = deepSearchForSongs(value, path + "." + key);
        if (result) return result;
      }
    }
  }

  return null;
}

/**
 * 判断一个数组是否可能是歌曲数组（更严格的多元素检查）
 * @param {Array} array - 要检查的数组
 * @returns {boolean} 是否可能是歌曲数组
 */
function isSongArray(array) {
  if (!Array.isArray(array) || array.length === 0) return false;

  // 可能的歌曲属性
  const possibleProperties = [
    "title",
    "name",
    "artist",
    "singer",
    "author",
    "file_url",
    "url",
    "src",
    "id",
    "album",
    "duration",
    "time",
    "size",
    "format",
    "quality",
  ];

  // 检查数组中的多个元素（最多检查前5个元素或所有元素，取较小值）
  const checkCount = Math.min(array.length, 5);
  let totalMatches = 0;
  let objectsWithProperties = 0;

  for (let i = 0; i < checkCount; i++) {
    const item = array[i];
    if (typeof item === "object" && item !== null) {
      objectsWithProperties++;
      // 计算当前元素匹配的属性数量
      const matches = possibleProperties.filter((prop) => prop in item).length;
      totalMatches += matches;
    }
  }

  // 如果没有对象元素，直接返回false
  if (objectsWithProperties === 0) return false;

  // 计算平均每个对象元素的匹配属性数量
  const averageMatches = totalMatches / objectsWithProperties;

  // 如果平均每个对象有2个或更多匹配的属性，或者至少有一个对象有3个或更多匹配的属性，就认为可能是歌曲数组
  return averageMatches >= 2 || totalMatches >= 3;
}

/**
 * 获取沙箱中重要的变量
 * @param {object} sandbox - 沙箱环境
 * @returns {object} 重要变量
 */
function getImportantSandboxVariables(sandbox) {
  const importantKeys = [
    "module",
    "exports",
    "lx",
    "songs",
    "music",
    "tracks",
    "playlist",
    "data",
    "result",
  ];
  const result = {};

  for (const key of importantKeys) {
    if (typeof sandbox[key] !== "undefined") {
      if (typeof sandbox[key] === "object" && sandbox[key] !== null) {
        if (Array.isArray(sandbox[key])) {
          result[key] = { type: "array", length: sandbox[key].length };
        } else {
          result[key] = { type: "object", keys: Object.keys(sandbox[key]) };
        }
      } else {
        result[key] = { type: typeof sandbox[key], value: sandbox[key] };
      }
    }
  }

  return result;
}

// 启动执行
main();
