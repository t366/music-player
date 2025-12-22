const { spawn } = require("child_process");
const path = require("path");

/**
 * 安全执行音乐源脚本，使用子进程隔离执行环境
 * @param {string} content - 脚本内容
 * @param {string} filename - 文件名
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<object>} 执行结果
 */
async function executeMusicSourceScript(content, filename, timeout = 60000) {
  return new Promise((resolve, reject) => {
    // 创建子进程执行脚本
    const childProcess = spawn(
      "node",
      [path.join(__dirname, "script-executor-child.js")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: timeout + 1000, // 子进程超时时间比执行超时多1秒
        env: {
          ...process.env,
          SCRIPT_TIMEOUT: timeout.toString(),
        },
      },
    );

    let output = "";
    let errorOutput = "";

    // 处理子进程输出
    childProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    // 处理子进程错误输出
    childProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    // 子进程执行完成
    childProcess.on("close", (code) => {
      try {
        if (code !== 0) {
          reject(
            new Error(
              `子进程执行失败，退出码: ${code}\n错误输出: ${errorOutput}`,
            ),
          );
          return;
        }

        // 解析输出
        const result = JSON.parse(output);
        resolve(result);
      } catch (parseError) {
        reject(
          new Error(
            `解析执行结果失败: ${parseError.message}\n原始输出: ${output}\n错误输出: ${errorOutput}`,
          ),
        );
      }
    });

    // 子进程执行超时
    childProcess.on("timeout", () => {
      childProcess.kill();
      reject(new Error(`脚本执行超时（${timeout}毫秒）`));
    });

    // 子进程发生错误
    childProcess.on("error", (error) => {
      reject(new Error(`子进程创建失败: ${error.message}`));
    });

    // 向子进程发送脚本内容
    const inputData = JSON.stringify({
      content: content,
      filename: filename,
    });

    childProcess.stdin.write(inputData);
    childProcess.stdin.end();
  });
}

module.exports = { executeMusicSourceScript };
