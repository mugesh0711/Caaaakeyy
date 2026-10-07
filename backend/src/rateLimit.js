'use strict';

const { HttpError } = require('./http');

/**
 * In-memory fixed-window rate limiter, keyed by client IP.
 *   const limit = rateLimit({ windowMs: 15 * 60e3, max: 20 });
 *   router.post('/api/auth/login', limit, handler);
 */
function rateLimit({ windowMs, max, message = 'Too many requests, please try again later' }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset < now) hits.delete(key);
  }, windowMs).unref();

  return function limiter(req, res) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      throw new HttpError(429, message);
    }
  };
}

module.exports = rateLimit;
