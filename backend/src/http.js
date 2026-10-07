'use strict';

/**
 * Small HTTP helpers shared by every route.
 */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const MAX_BODY_BYTES = 100 * 1024; // 100 KB is plenty for forms and carts

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return {};
  // Vercel reads the body before our code runs and offers it as req.body.
  const raw = 'body' in req ? alreadyRead(req) : await readStream(req);
  return parseJson(raw.trim(), req.headers['content-type'] || '');
}

function alreadyRead(req) {
  let body;
  try {
    body = req.body;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return JSON.stringify(body);
}

function readStream(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw, type) {
  if (!raw) return {};
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large');
  if (!type.includes('application/json')) throw new HttpError(415, 'Send data as application/json');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON body must be an object');
  }
  return parsed;
}

module.exports = { HttpError, sendJson, readJsonBody };
