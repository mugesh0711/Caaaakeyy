'use strict';
/**
 * End-to-end API test. Run with:  npm test   (or: node test/api.test.js)
 * Uses a temporary copy of the database so your real data is untouched.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'data', 'db.json');
const BACKUP = DB + '.test-backup';
let server, base;

before(async () => {
  if (fs.existsSync(DB)) fs.renameSync(DB, BACKUP);
  server = require('../server');
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (fs.existsSync(DB)) fs.unlinkSync(DB);
  if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, DB);
});

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('health + products + search', async () => {
  assert.equal((await api('GET', '/api/health')).status, 200);
  const all = await api('GET', '/api/products');
  assert.equal(all.status, 200);
  assert.ok(all.data.products.length >= 12);
  const choc = await api('GET', '/api/products?category=chocolate');
  assert.ok(choc.data.products.every((p) => p.categories.includes('chocolate')));
  const q = await api('GET', '/api/products?q=velvet');
  assert.ok(q.data.products.length >= 2);
  assert.equal((await api('GET', '/api/products/nope')).status, 404);
});

test('register, login, cart, order', async () => {
  const bad = await api('POST', '/api/auth/register', { name: 'A', email: 'x', password: '1' });
  assert.equal(bad.status, 400);

  const reg = await api('POST', '/api/auth/register', { name: 'Mugesh', email: 'Test@Example.com', password: 'secret123' });
  assert.equal(reg.status, 201);
  assert.ok(reg.data.token);
  assert.equal(reg.data.user.email, 'test@example.com');
  assert.equal(reg.data.user.passwordHash, undefined);

  assert.equal((await api('POST', '/api/auth/register', { name: 'Again', email: 'test@example.com', password: 'secret123' })).status, 409);
  assert.equal((await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'wrong-pass' })).status, 401);

  const login = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'secret123' });
  assert.equal(login.status, 200);
  const t = login.data.token;

  assert.equal((await api('GET', '/api/cart')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', null, t + 'x')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', null, t)).data.user.name, 'Mugesh');

  let cart = await api('POST', '/api/cart/items', { productId: 'honey-cake', qty: 2 }, t);
  assert.equal(cart.data.subtotal, 798);
  assert.equal(cart.data.delivery, 49); // under the free-delivery threshold
  cart = await api('PATCH', '/api/cart/items/honey-cake', { qty: 1 }, t);
  assert.equal(cart.data.subtotal, 399);
  assert.equal(cart.data.delivery, 49);
  cart = await api('POST', '/api/cart/merge', { items: [{ productId: 'mocha', qty: 1 }, { productId: 'fake', qty: 3 }] }, t);
  assert.equal(cart.data.count, 2);
  assert.equal(cart.data.total, 399 + 1299);

  assert.equal((await api('POST', '/api/orders', { name: 'Mugesh', phone: '12', address: 'x' }, t)).status, 400);
  const order = await api('POST', '/api/orders', { name: 'Mugesh', phone: '7695890806', address: 'Old bus stand, Thanjavur' }, t);
  assert.equal(order.status, 201);
  assert.equal(order.data.order.total, 1698);
  assert.equal((await api('GET', '/api/cart', null, t)).data.count, 0);
  assert.equal((await api('GET', '/api/orders', null, t)).data.orders.length, 1);
  assert.equal((await api('POST', '/api/orders', { name: 'Mugesh', phone: '7695890806', address: 'Old bus stand, Thanjavur' }, t)).status, 400);
});

test('contact form', async () => {
  assert.equal((await api('POST', '/api/contact', { firstName: 'Ravi', contact: 'nope', message: 'hello there' })).status, 400);
  const ok = await api('POST', '/api/contact', { firstName: 'Ravi', contact: 'ravi@mail.com', message: 'Do you deliver on Sundays?' });
  assert.equal(ok.status, 201);
});

test('static files and blocked paths', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/menu.html')).status, 200);
  assert.equal((await fetch(base + '/backend/data/db.json')).status, 404);
  assert.equal((await fetch(base + '/backend/server.js')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
});
