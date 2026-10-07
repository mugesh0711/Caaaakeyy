'use strict';

/**
 * Per-user shopping cart stored on the server.
 * Prices are always looked up from the catalog — the client never sets them.
 */
const db = require('../db');
const v = require('../validate');
const { HttpError, sendJson } = require('../http');
const { requireAuth } = require('../auth');

const MAX_QTY = 20;
const FREE_DELIVERY_FROM = 999;
const DELIVERY_FEE = 49;

function findProduct(id) {
  const product = db.products().find((p) => p.id === id);
  if (!product) throw new HttpError(404, `Product "${id}" does not exist`);
  return product;
}

/** Turns [{productId, qty}] into a priced cart summary. */
function summarize(rawItems = []) {
  const items = [];
  for (const { productId, qty } of rawItems) {
    const p = db.products().find((x) => x.id === productId);
    if (!p) continue; // product was removed from the menu
    items.push({ productId, name: p.name, image: p.image, price: p.price, qty, lineTotal: p.price * qty });
  }
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const delivery = subtotal === 0 || subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
  return {
    items,
    count: items.reduce((s, i) => s + i.qty, 0),
    subtotal,
    delivery,
    total: subtotal + delivery,
    freeDeliveryFrom: FREE_DELIVERY_FROM,
  };
}

const cartOf = (data, userId) => (data.carts[userId] ||= []);

module.exports = function cartRoutes(router) {
  // GET /api/cart
  router.get('/api/cart', requireAuth, async (req, res) => {
    sendJson(res, 200, summarize((await db.read()).carts[req.user.id]));
  });

  // POST /api/cart/items  { productId, qty }  -> adds to existing quantity
  router.post('/api/cart/items', requireAuth, async (req, res) => {
    const productId = v.str(req.body.productId, { field: 'productId', max: 60 });
    const qty = v.int(req.body.qty ?? 1, { field: 'Quantity', min: 1, max: MAX_QTY });
    findProduct(productId);

    const cart = await db.update((data) => {
      const items = cartOf(data, req.user.id);
      const line = items.find((i) => i.productId === productId);
      if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
      else items.push({ productId, qty });
      return items;
    });
    sendJson(res, 200, summarize(cart));
  });

  // PATCH /api/cart/items/:productId  { qty }  -> sets quantity (0 removes)
  router.patch('/api/cart/items/:productId', requireAuth, async (req, res) => {
    const { productId } = req.params;
    const qty = v.int(req.body.qty, { field: 'Quantity', min: 0, max: MAX_QTY });

    const cart = await db.update((data) => {
      const items = cartOf(data, req.user.id);
      const line = items.find((i) => i.productId === productId);
      if (!line) throw new HttpError(404, 'That item is not in your cart');
      if (qty === 0) data.carts[req.user.id] = items.filter((i) => i.productId !== productId);
      else line.qty = qty;
      return data.carts[req.user.id];
    });
    sendJson(res, 200, summarize(cart));
  });

  // DELETE /api/cart/items/:productId
  router.delete('/api/cart/items/:productId', requireAuth, async (req, res) => {
    const cart = await db.update((data) => {
      data.carts[req.user.id] = cartOf(data, req.user.id).filter((i) => i.productId !== req.params.productId);
      return data.carts[req.user.id];
    });
    sendJson(res, 200, summarize(cart));
  });

  // DELETE /api/cart  -> empty the cart
  router.delete('/api/cart', requireAuth, async (req, res) => {
    await db.update((data) => { data.carts[req.user.id] = []; });
    sendJson(res, 200, summarize([]));
  });

  // POST /api/cart/merge  { items: [{productId, qty}] }
  // Used right after login to move a guest cart (saved in the browser) to the account.
  router.post('/api/cart/merge', requireAuth, async (req, res) => {
    const incoming = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
    const cart = await db.update((data) => {
      const items = cartOf(data, req.user.id);
      for (const raw of incoming) {
        const productId = typeof raw?.productId === 'string' ? raw.productId : '';
        const qty = Number(raw?.qty);
        if (!db.products().some((p) => p.id === productId)) continue;
        if (!Number.isInteger(qty) || qty < 1) continue;
        const line = items.find((i) => i.productId === productId);
        if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
        else items.push({ productId, qty: Math.min(MAX_QTY, qty) });
      }
      return items;
    });
    sendJson(res, 200, summarize(cart));
  });
};

module.exports.summarize = summarize;
