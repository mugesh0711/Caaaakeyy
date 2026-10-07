'use strict';

/**
 * Caaaakeyy server (your computer, Railway, Render, any Node.js host)
 * ------------------------------------------------------------------
 * One Node.js process that:
 *   1. serves the website (index.html, menu.html, photos, css, js) and
 *   2. answers the JSON REST API under /api  (code in src/app.js).
 *
 * No npm packages are needed. From the project folder run:   npm start
 * Then open:                                                    http://localhost:5000
 *
 * On Vercel this file is not used — api/index.js runs the same API
 * automatically as a serverless function.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./src/config');
const { handleApi, setSecurityHeaders, init } = require('./src/app');
const { HttpError } = require('./src/http');

const SITE_ROOT = path.resolve(__dirname, '..');

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

  if (isApi) {
    res.on('finish', () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
    return handleApi(req, res, url);
  }

  setSecurityHeaders(res);
  try {
    serveStatic(req, res, url);
  } catch (err) {
    sendPageError(res, err);
  }
});

// ---- static files --------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Never expose the server code, its data, or dot-files (like .git / .env).
const BLOCKED = [/^\/backend(\/|$)/i, /^\/api(\/|$)/i, /\/\./, /^\/node_modules(\/|$)/i];

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Bad URL');
  }
  if (pathname.includes('\0') || BLOCKED.some((re) => re.test(pathname))) throw new HttpError(404, 'Not found');
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.resolve(SITE_ROOT, `.${pathname}`);
  if (!filePath.startsWith(SITE_ROOT + path.sep)) throw new HttpError(404, 'Not found');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendPageError(res, new HttpError(404, 'Not found'));
    const ext = path.extname(filePath).toLowerCase();
    const isImage = /^image\//.test(MIME[ext] || '');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isImage ? 'public, max-age=604800' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function sendPageError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(status === 404 ? 'Page not found' : 'Server error');
}

// ---- start -------------------------------------------------------------------

if (require.main === module) {
  // No host given = listen on every network interface (IPv4 + IPv6),
  // which is what Railway/Render/Docker need. PORT comes from the host.
  server.listen(config.port, () => {
    console.log('');
    console.log('  🎂  Caaaakeyy is running');
    console.log(`  ➜  Website: http://localhost:${config.port}`);
    console.log(`  ➜  API:     http://localhost:${config.port}/api/health`);
    console.log(`  ➜  Data:    ${config.storage === 'redis' ? 'Upstash Redis' : config.dataDir}`);
    console.log('');
    init().catch((err) => console.error('[startup]', err.message));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Close the other program or set PORT in backend/.env`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = server;
