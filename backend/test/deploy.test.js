'use strict';
/**
 * Deployment tests: runs the API the way Vercel runs it (api/index.js),
 * with an Upstash-style database shared by two separate "instances".
 * Run with:  npm test   (from the project folder)
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeUpstash } = require('./helpers/fake-upstash');

const ROOT = path.join(__dirname, '..', '..');
const children = [];
let redis;
let A; // Vercel instance that receives rewritten URLs (/api/index?apiPath=...)
let B; // Vercel instance that receives original URLs
let C; // Vercel instance with NO database connected
let tmpDir;

function startInstance(env) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'helpers', 'vercel-instance.js'), [], {
      env: { PATH: process.env.PATH, VERCEL: '1', ...env },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('message', ({ port }) => resolve(`http://127.0.0.1:${port}`));
    child.once('exit', (code) => reject(new Error(`instance exited (${code}): ${stderr}`)));
    children.push(child);
  });
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caaaakeyy-test-'));
  redis = process.env.UPSTASH_TEST_URL
    ? { url: process.env.UPSTASH_TEST_URL, token: process.env.UPSTASH_TEST_TOKEN, close() {} }
    : await startFakeUpstash('test-token');
  const db = { KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: redis.token };
  [A, B, C] = await Promise.all([
    startInstance({ ...db, EMULATE_REWRITE: '1' }),
    startInstance({ ...db }),
    startInstance({ DATA_DIR: tmpDir }),
  ]);
});

after(() => {
  for (const child of children) child.kill();
  redis.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(base, method, url, body, { token, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

test('vercel.json sends /api to the function and hides backend files', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.deepEqual(config.rewrites, [{ source: '/api/:apiPath*', destination: '/api/index' }]);
  assert.ok(config.redirects.some((r) => r.source === '/backend/:path*'));
  assert.ok(fs.existsSync(path.join(ROOT, 'api', 'index.js')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node backend/server.js');
  assert.equal(pkg.dependencies, undefined, 'no npm packages needed');
});

test('both URL styles reach the API; products, search and query strings work', async () => {
  for (const base of [A, B]) {
    const health = await api(base, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.storage, 'redis');
    const q = await api(base, 'GET', '/api/products?q=velvet&sort=price-asc');
    assert.ok(q.data.products.length >= 2);
    assert.ok(q.data.products.every((p, i, l) => i === 0 || l[i - 1].price <= p.price));
    assert.equal((await api(base, 'GET', '/api/products/red-velvet-nope')).status, 404);
    assert.equal((await api(base, 'GET', '/api/nothing-here')).status, 404);
    assert.equal(health.headers.get('access-control-allow-origin'), '*');
  }
});

test('Vercel + database: instances share accounts, logins and carts', async () => {
  const reg = await api(A, 'POST', '/api/auth/register', { name: 'Mugesh', email: 'share@example.com', password: 'secret123' });
  assert.equal(reg.status, 201);

  const login = await api(B, 'POST', '/api/auth/login', { email: 'share@example.com', password: 'secret123' });
  assert.equal(login.status, 200, 'account made on A must exist on B');

  // A token signed by one instance is accepted by the other (shared secret in the database).
  assert.equal((await api(A, 'GET', '/api/auth/me', undefined, { token: login.data.token })).data.user.name, 'Mugesh');
  assert.equal((await api(B, 'GET', '/api/auth/me', undefined, { token: reg.data.token })).status, 200);

  await api(A, 'POST', '/api/cart/items', { productId: 'honey-cake', qty: 2 }, { token: reg.data.token });
  const cart = await api(B, 'GET', '/api/cart', undefined, { token: reg.data.token });
  assert.equal(cart.data.count, 2);
  assert.equal(cart.data.subtotal, 798);

  const order = await api(B, 'POST', '/api/orders', { name: 'Mugesh', phone: '7695890806', address: 'Old bus stand, Thanjavur' }, { token: reg.data.token });
  assert.equal(order.status, 201);
  assert.equal((await api(A, 'GET', '/api/orders', undefined, { token: reg.data.token })).data.orders.length, 1);
  assert.equal((await api(A, 'GET', '/api/cart', undefined, { token: reg.data.token })).data.count, 0);
});

test('no lost updates when two instances write at the same time', async () => {
  const { data } = await api(A, 'POST', '/api/auth/register', { name: 'Busy Buyer', email: 'busy@example.com', password: 'secret123' });
  const token = data.token;
  const ids = (await api(A, 'GET', '/api/products')).data.products.slice(0, 10).map((p) => p.id);

  // 20 adds at once, alternating instances: each of 10 cakes added twice.
  const jobs = [];
  ids.forEach((id, i) => {
    jobs.push(api(i % 2 ? A : B, 'POST', '/api/cart/items', { productId: id, qty: 1 }, { token }));
    jobs.push(api(i % 2 ? B : A, 'POST', '/api/cart/items', { productId: id, qty: 1 }, { token }));
  });
  const results = await Promise.all(jobs);
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));

  const cart = await api(B, 'GET', '/api/cart', undefined, { token });
  assert.equal(cart.data.count, 20);
  assert.ok(cart.data.items.every((i) => i.qty === 2));

  // Same email registered on both instances at once: exactly one wins.
  const [r1, r2] = await Promise.all([
    api(A, 'POST', '/api/auth/register', { name: 'Twin', email: 'twin@example.com', password: 'secret123' }),
    api(B, 'POST', '/api/auth/register', { name: 'Twin', email: 'twin@example.com', password: 'secret123' }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
});

test('request bodies pre-read by Vercel are validated', async () => {
  assert.equal((await api(A, 'POST', '/api/contact', '{"firstName": "Ravi",')).status, 400);
  assert.equal((await api(B, 'POST', '/api/contact', { firstName: 'Ravi', contact: 'ravi@mail.com', message: 'Sunday delivery?' })).status, 201);
  const wrongType = await api(B, 'POST', '/api/contact', 'hello', { headers: { 'Content-Type': 'text/plain' } });
  assert.equal(wrongType.status, 415);
});

test('Vercel without a database still works (temporary storage)', async () => {
  const health = await api(C, 'GET', '/api/health');
  assert.equal(health.data.storage, 'temporary');
  const reg = await api(C, 'POST', '/api/auth/register', { name: 'Temp', email: 'temp@example.com', password: 'secret123' });
  assert.equal(reg.status, 201);
  assert.equal((await api(C, 'GET', '/api/auth/me', undefined, { token: reg.data.token })).status, 200);
});

test('rate limit counts each visitor separately behind the Vercel proxy', async () => {
  const attempt = (ip) => api(C, 'POST', '/api/auth/login', { email: 'temp@example.com', password: 'wrong-pass' }, { headers: { 'x-real-ip': ip } });
  for (let i = 0; i < 20; i++) assert.equal((await attempt('203.0.113.1')).status, 401);
  assert.equal((await attempt('203.0.113.1')).status, 429, 'same visitor is limited');
  assert.equal((await attempt('203.0.113.2')).status, 401, 'other visitors are not');
});
