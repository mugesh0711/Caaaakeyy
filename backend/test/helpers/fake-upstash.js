'use strict';

/**
 * A tiny in-memory stand-in for Upstash Redis's REST API, for tests.
 * Speaks the same format: POST a JSON array like ["SET","k","v"],
 * get back {"result": ...} or {"error": "..."}.
 * Supports the commands our db.js uses: GET, SET (NX), MGET, INCR, EVAL.
 */
const http = require('http');

function startFakeUpstash(token) {
  const kv = new Map();
  const stats = { commands: 0 };

  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      // Small random delay so concurrent requests interleave like the real network.
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      }, Math.random() * 8);
    };
    if (req.method !== 'POST') return reply(405, { error: 'POST only in this fake' });
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'WRONGPASS invalid password' });

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let cmd;
      try {
        cmd = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { error: 'ERR invalid JSON' });
      }
      stats.commands += 1;
      const [name, ...args] = cmd;
      switch (String(name).toUpperCase()) {
        case 'GET':
          return reply(200, { result: kv.has(args[0]) ? kv.get(args[0]) : null });
        case 'MGET':
          return reply(200, { result: args.map((k) => (kv.has(k) ? kv.get(k) : null)) });
        case 'SET': {
          const [key, value, ...opts] = args;
          if (opts.map((o) => String(o).toUpperCase()).includes('NX') && kv.has(key)) return reply(200, { result: null });
          kv.set(key, String(value));
          return reply(200, { result: 'OK' });
        }
        case 'INCR': {
          const next = Number(kv.get(args[0]) || 0) + 1;
          kv.set(args[0], String(next));
          return reply(200, { result: next });
        }
        case 'EVAL': {
          // Mirrors the compare-and-set script in db.js (atomic: JS is single-threaded).
          const [, numKeys, ...rest] = args;
          const n = Number(numKeys);
          const [dataKey, revKey] = rest.slice(0, n);
          const [expectedRev, value] = rest.slice(n);
          const current = kv.has(revKey) ? kv.get(revKey) : '0';
          if (current !== String(expectedRev)) return reply(200, { result: 0 });
          kv.set(dataKey, String(value));
          kv.set(revKey, String(Number(current) + 1));
          return reply(200, { result: 1 });
        }
        default:
          return reply(400, { error: `ERR unknown command '${name}'` });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, token, kv, stats, close: () => server.close() });
    });
  });
}

module.exports = { startFakeUpstash };
