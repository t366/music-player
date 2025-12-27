const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error(`请求错误: ${error}`);
});

req.end();