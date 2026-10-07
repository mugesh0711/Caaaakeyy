'use strict';

/**
 * Settings read from environment variables (or backend/.env on your computer).
 *
 * Where data is stored is picked automatically:
 *   - "redis"     Upstash Redis is connected (UPSTASH_REDIS_REST_URL/TOKEN or
 *                 KV_REST_API_URL/TOKEN) — data is permanent. Best for Vercel/Railway.
 *   - "file"      A JSON file in backend/data (or DATA_DIR) — your computer, or a
 *                 Railway volume.
 *   - "temporary" On Vercel with no database connected — works, but accounts and
 *                 orders reset whenever Vercel restarts the function.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

loadEnvFile(path.join(__dirname, '..', '.env'));

const env = process.env;
const onVercel = Boolean(env.VERCEL);
const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);

const { redisUrl, redisToken } = findRedis();

let storage = 'file';
if (redisUrl && redisToken) storage = 'redis';
else if (onVercel) storage = 'temporary';

const dataDir = env.DATA_DIR
  ? path.resolve(env.DATA_DIR)
  : onVercel
    ? path.join(os.tmpdir(), 'caaaakeyy') // the only writable folder on Vercel
    : path.join(__dirname, '..', 'data');

module.exports = {
  port: Number(env.PORT) || 5000,
  onVercel,
  onRailway,
  storage,
  dataDir,
  redis: { url: redisUrl.replace(/\/+$/, ''), token: redisToken, prefix: 'caaaakeyy' },
  // Behind Vercel/Railway the visitor's IP arrives in a header, not on the socket.
  trustProxy: env.TRUST_PROXY === '1' || onVercel || onRailway,
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS) || 168,
};

/**
 * Finds Upstash Redis credentials. Vercel's Storage tab adds KV_REST_API_URL /
 * KV_REST_API_TOKEN (or with a prefix you chose, e.g. CAKE_KV_REST_API_URL);
 * the Upstash console gives UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 */
function findRedis() {
  const preferred = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'];
  const others = Object.keys(process.env).filter((k) => /(KV_REST_API|UPSTASH_REDIS_REST)_URL$/.test(k)).sort();
  for (const urlKey of [...preferred, ...others]) {
    const tokenKey = urlKey.replace(/URL$/, 'TOKEN');
    if (process.env[urlKey] && process.env[tokenKey]) {
      return { redisUrl: process.env[urlKey], redisToken: process.env[tokenKey] };
    }
  }
  return { redisUrl: '', redisToken: '' };
}

/** Reads KEY=value lines from .env into process.env (no dotenv package needed). */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
