'use strict';

const db = require('../db');
const { HttpError, sendJson } = require('../http');

const CATEGORIES = [
  { id: 'red-velvet', name: 'Red Velvet' },
  { id: 'sponge', name: 'Sponge Cake' },
  { id: 'fruit', name: 'Fruit Cake' },
  { id: 'cheesecake', name: 'Cheese Cake' },
  { id: 'chocolate', name: 'Chocolate Cake' },
  { id: 'butter', name: 'Butter Cake' },
];

module.exports = function productRoutes(router) {
  // GET /api/categories
  router.get('/api/categories', async (req, res) => {
    sendJson(res, 200, { categories: CATEGORIES });
  });

  // GET /api/products?q=choco&category=chocolate&sort=price-asc
  router.get('/api/products', async (req, res) => {
    const q = (req.query.get('q') || '').trim().toLowerCase().slice(0, 60);
    const category = (req.query.get('category') || '').trim().toLowerCase();
    const sort = req.query.get('sort') || '';

    let list = db.products().filter((p) => {
      const matchesQ = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      const matchesCat = !category || category === 'all' || p.categories.includes(category);
      return matchesQ && matchesCat;
    });

    if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));

    sendJson(res, 200, { count: list.length, products: list });
  });

  // GET /api/products/:id
  router.get('/api/products/:id', async (req, res) => {
    const product = db.products().find((p) => p.id === req.params.id);
    if (!product) throw new HttpError(404, 'Product not found');
    sendJson(res, 200, { product });
  });
};
