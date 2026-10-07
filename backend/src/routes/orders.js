'use strict';

const db = require('../db');
const v = require('../validate');
const { HttpError, sendJson } = require('../http');
const { requireAuth } = require('../auth');
const { summarize } = require('./cart');

module.exports = function orderRoutes(router) {
  // POST /api/orders  { name, phone, address, note? }  -> checks out the current cart
  router.post('/api/orders', requireAuth, async (req, res) => {
    const name = v.str(req.body.name, { field: 'Name', min: 2, max: 60 });
    const phone = v.phone(req.body.phone);
    const address = v.str(req.body.address, { field: 'Address', min: 8, max: 300 });
    const note = v.str(req.body.note, { field: 'Note', max: 300, required: false });

    const order = await db.update((data) => {
      const summary = summarize(data.carts[req.user.id]);
      if (summary.items.length === 0) throw new HttpError(400, 'Your cart is empty');

      const created = {
        id: db.newId('ord'),
        userId: req.user.id,
        customer: { name, phone, address, note },
        items: summary.items,
        subtotal: summary.subtotal,
        delivery: summary.delivery,
        total: summary.total,
        status: 'placed',
        createdAt: new Date().toISOString(),
      };
      data.orders.push(created);
      data.carts[req.user.id] = [];
      return created;
    });

    sendJson(res, 201, { order });
  });

  // GET /api/orders  -> my orders, newest first
  router.get('/api/orders', requireAuth, async (req, res) => {
    const orders = (await db.read()).orders
      .filter((o) => o.userId === req.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, 200, { orders });
  });

  // GET /api/orders/:id
  router.get('/api/orders/:id', requireAuth, async (req, res) => {
    const order = (await db.read()).orders.find((o) => o.id === req.params.id && o.userId === req.user.id);
    if (!order) throw new HttpError(404, 'Order not found');
    sendJson(res, 200, { order });
  });
};
