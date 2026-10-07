'use strict';

/**
 * Runs api/index.js the way Vercel does, so it can be tested without Vercel:
 *   - the request body is read BEFORE the function runs and offered as a
 *     req.body getter (Vercel's "helpers"); the stream is already used up
 *   - with EMULATE_REWRITE=1 the function sees the rewritten URL
 *     (/api/index?apiPath=...) instead of the original one
 * Started by deploy.test.js with child_process.fork(); reports its port back.
 */
const http = require('http');
const handler = require('../../../api/index.js');

const rewrite = process.env.EMULATE_REWRITE === '1';

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const type = req.headers['content-type'];

  Object.defineProperty(req, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      if (type === undefined) return undefined;
      if (type.includes('application/json')) {
        if (!raw.length) return undefined;
        return JSON.parse(raw.toString('utf8')); // throws on bad JSON, like Vercel
      }
      if (type.includes('text/plain')) return raw.toString('utf8');
      return raw;
    },
  });

  if (rewrite) {
    const url = new URL(req.url, 'http://localhost');
    url.searchParams.set('apiPath', url.pathname.replace(/^\/api\/?/, ''));
    req.url = `/api/index${url.search}`;
  }

  await handler(req, res);
});

server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
