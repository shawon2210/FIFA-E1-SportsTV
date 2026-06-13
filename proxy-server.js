// A1TV Reverse Proxy - zero dependencies
// Serves static frontend, proxies API/WebSocket to backend
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const FRONTEND_ROOT = path.resolve(__dirname);
const BACKEND_HOST = 'localhost';
const BACKEND_PORT = 3000;
const PORT = 8081;

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function shouldProxy(url) {
  return url.startsWith('/api/') || url.startsWith('/ws') || 
         url.startsWith('/socket.io/') || url.startsWith('/metrics') || 
         url === '/health';
}

function proxyRequest(req, res) {
  const options = {
    hostname: BACKEND_HOST,
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backend unavailable' }));
    }
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (shouldProxy(req.url)) {
    proxyRequest(req, res);
    return;
  }

  let filePath = path.join(FRONTEND_ROOT, req.url === '/' ? 'index.html' : req.url);
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(FRONTEND_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(FRONTEND_ROOT, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`A1TV running on http://localhost:${PORT}`);
  console.log(`API proxied to http://${BACKEND_HOST}:${BACKEND_PORT}`);
});
