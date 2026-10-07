'use strict';

/**
 * Storage for users, carts, orders and contact messages.
 *
 * All data is one JSON document:
 *   { users: [], carts: {}, orders: [], messages: [] }
 *
 *   const data = await db.read();
 *   await db.update((data) => { data.users.push(user); });
 *
 * update() is all-or-nothing: if the function throws (for example
 * "email already exists"), nothing is saved.
 *
 * Two backends, chosen automatically in config.js:
 *   - file  : backend/data/db.json, written atomically (temp file + rename)
 *   - redis : Upstash Redis over HTTPS (no npm package), with a
 *             compare-and-set so two servers writing at once never lose data
 *
 * Products are read-only and come from data/products.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { HttpError } = require('./http');

const PRODUCTS = require('../data/products.json');
const EMPTY = () => ({ users: [], carts: {}, orders: [], messages: [] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- file storage ---------------------------------------------------------

function createFileStore(dir) {
  const file = path.join(dir, 'db.json');
  let state = null;
  let queue = Promise.resolve();

  function load() {
    if (state) return state;
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      state = EMPTY();
      return state;
    }
    try {
      state = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      const backup = `${file}.corrupt-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.warn(`[db] db.json was unreadable, backed up to ${backup} and starting fresh`);
      state = EMPTY();
    }
    return state;
  }

  async function save(data) {
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, file);
  }

  // One change at a time, so two requests never overwrite each other.
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  return {
    file,
    async read() {
      return load();
    },
    update(mutator) {
      return serial(async () => {
        const draft = structuredClone(load());
        const result = await mutator(draft);
        await save(draft);
        state = draft;
        return result;
      });
    },
    async secret(name) {
      const secretFile = path.join(dir, `.${name}`);
      if (!fs.existsSync(secretFile)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
      }
      return fs.readFileSync(secretFile, 'utf8').trim();
    },
  };
}

// ---- Upstash Redis storage ------------------------------------------------

// Saves only if nobody else saved since we read (revision unchanged).
const COMPARE_AND_SET = `
if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('INCR', KEYS[2])
return 1`;

function createRedisStore({ url, token, prefix }) {
  const DATA_KEY = `${prefix}:db`;
  const REV_KEY = `${prefix}:rev`;

  async function call(...command) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      throw new Error(`[db] Could not reach Upstash Redis (${err.message})`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      throw new Error(`[db] Redis ${command[0]} failed: ${body.error || `HTTP ${res.status}`}`);
    }
    return body.result;
  }

  async function snapshot() {
    const [raw, rev] = await call('MGET', DATA_KEY, REV_KEY);
    if (!raw) return { data: EMPTY(), rev: rev || '0' };
    try {
      return { data: { ...EMPTY(), ...JSON.parse(raw) }, rev: rev || '0' };
    } catch {
      throw new Error(`[db] Redis key ${DATA_KEY} does not contain valid JSON`);
    }
  }

  return {
    async read() {
      return (await snapshot()).data;
    },
    async update(mutator) {
      for (let attempt = 1; attempt <= 8; attempt++) {
        const { data, rev } = await snapshot();
        const result = await mutator(data);
        const saved = await call('EVAL', COMPARE_AND_SET, '2', DATA_KEY, REV_KEY, String(rev), JSON.stringify(data));
        if (Number(saved) === 1) return result;
        await sleep(15 * attempt + Math.random() * 40); // someone else saved first: retry
      }
      throw new HttpError(503, 'The shop is very busy right now. Please try again.');
    },
    async secret(name) {
      const key = `${prefix}:${name}`;
      await call('SET', key, crypto.randomBytes(48).toString('hex'), 'NX');
      return call('GET', key);
    },
  };
}

// ---- pick one ------------------------------------------------------------

const store = config.storage === 'redis' ? createRedisStore(config.redis) : createFileStore(config.dataDir);

if (config.storage === 'temporary') {
  console.warn('[db] No database connected on Vercel: accounts, carts and orders are TEMPORARY. ' +
    'Connect Upstash Redis (Vercel → Storage) to keep them.');
} else if (config.storage === 'file' && config.onRailway && !process.env.DATA_DIR) {
  console.warn('[db] Railway: data in backend/data is wiped on every redeploy. ' +
    'Attach a Volume and set DATA_DIR, or add Upstash Redis variables.');
}

module.exports = {
  mode: config.storage,
  read: () => store.read(),
  update: (mutator) => store.update(mutator),
  secret: (name) => store.secret(name),
  products: () => PRODUCTS,
  newId: (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`,
};
