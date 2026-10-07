'use strict';

/**
 * Password hashing (scrypt) and login tokens (JWT, HS256) using only
 * Node's built-in crypto module.
 */
const crypto = require('crypto');
const { HttpError } = require('./http');
const db = require('./db');
const config = require('./config');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---- JWT ----------------------------------------------------------------

const b64url = (input) => Buffer.from(input).toString('base64url');

let secret = null;

/**
 * Picks the key used to sign login tokens: JWT_SECRET if it is long enough,
 * otherwise one generated once and kept in the database (so every server /
 * Vercel instance shares it and logins survive restarts).
 */
async function loadSecret() {
  const fromEnv = process.env.JWT_SECRET || '';
  if (fromEnv.length >= 32 && !fromEnv.startsWith('change-me')) {
    secret = fromEnv;
  } else {
    if (fromEnv) console.warn('[auth] JWT_SECRET is too short or still the example value — using a generated one');
    secret = await db.secret('jwt-secret');
  }
  return secret;
}

function getSecret() {
  if (!secret) throw new Error('loadSecret() must run before tokens are used');
  return secret;
}

function signToken(payload, ttlHours = config.tokenTtlHours) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + Math.round(ttlHours * 3600) };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Route guard: attaches req.user or responds 401. */
async function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) throw new HttpError(401, 'Please log in to continue');
  const user = (await db.read()).users.find((u) => u.id === payload.sub);
  if (!user) throw new HttpError(401, 'Account not found, please log in again');
  req.user = user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

module.exports = { hashPassword, verifyPassword, loadSecret, signToken, verifyToken, requireAuth, publicUser };
