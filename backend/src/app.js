'use strict';

/**
 * The Caaaakeyy REST API — one handler used everywhere:
 *   - backend/server.js  → your computer, Railway, or any Node.js host
 *   - api/index.js       → Vercel (runs automatically as a serverless function)
 */
const config = require('./config');
const db = require('./db');
const { loadSecret } = require('./auth');
const Router = require('./router');
const { HttpError, sendJson, readJsonBody } = require('./http');

const router = new Router();
require('./routes/auth')(router);
require('./routes/products')(router);
require('./routes/cart')(router);
require('./routes/orders')(router);
require('./routes/contact')(router);

router.get('/api/health', async (req, res) => {
  sendJson(res, 200, { ok: true, service: 'caaaakeyy-api', storage: db.mode, time: new Date().toISOString() });
});

// One-time setup (login-token key). Retried on the next request if it fails.
let ready = null;
function init() {
  if (!ready) {
    ready = loadSecret();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/**
 * Handles one /api request.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url  the request URL (path starts with /api)
 */
async function handleApi(req, res, url) {
  setSecurityHeaders(res);
  // The API uses Bearer tokens (not cookies), so allowing any origin is safe
  // and lets the pages work from VS Code Live Server too.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const { route, params, allowed } = router.match(req.method, url.pathname);
    if (!route) {
      if (allowed && allowed.length) {
        res.setHeader('Allow', allowed.join(', '));
        throw new HttpError(405, `Method ${req.method} not allowed here`);
      }
      throw new HttpError(404, `No API route for ${req.method} ${url.pathname}`);
    }

    await init();

    // What route handlers see as "req"
    const ctx = {
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      query: url.searchParams,
      params,
      body: await readJsonBody(req),
      ip: clientIp(req),
      user: null,
    };

    for (const handler of route.handlers) {
      await handler(ctx, res);
      if (res.writableEnded) return;
    }
  } catch (err) {
    sendError(res, err);
  }
}

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  sendJson(res, status, {
    error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on our side. Please try again.' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

function clientIp(req) {
  if (config.trustProxy) {
    const real = req.headers['x-real-ip'];
    if (real) return String(real).trim();
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1]; // added by the host's own proxy
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
}

module.exports = { handleApi, setSecurityHeaders, init, CSP };
