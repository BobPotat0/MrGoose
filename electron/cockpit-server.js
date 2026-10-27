const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Serve an existing client build without running Angular's dev server or loading its UI.
async function startCockpitServer(root, { port = 5175 } = {}) {
  if (!fs.existsSync(path.join(root, 'index.html'))) return null;
  const server = http.createServer((request, response) => {
    if (request.headers.host !== `127.0.0.1:${server.address().port}` || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); } catch { response.writeHead(400); response.end(); return; }
    let file = path.resolve(root, '.' + pathname);
    if (pathname.includes('\\') || !file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) { response.writeHead(403); response.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (!request.headers.accept?.includes('text/html') && pathname !== '/') { response.writeHead(404); response.end(); return; }
      file = path.join(root, 'index.html');
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') response.end();
    else {
      const stream = fs.createReadStream(file);
      stream.on('error', () => { if (!response.headersSent) response.writeHead(404); response.end(); });
      stream.pipe(response);
    }
  });
  // Stable origin preserves Angular localStorage/history across app restarts.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}
module.exports = { startCockpitServer };
