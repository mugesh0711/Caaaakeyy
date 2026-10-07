'use strict';

/**
 * A tiny Express-style router.
 *
 *   router.get('/api/products/:id', handler)
 *   router.post('/api/cart/items', requireAuth, handler)
 *
 * Each handler receives (req, res) and may be async. Handlers run in order;
 * a handler "passes" to the next one simply by returning without sending.
 */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, ...handlers) {
    const keys = [];
    const pattern = path
      .replace(/\/+$/, '')
      .replace(/:([A-Za-z_]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });
    this.routes.push({ method, regex: new RegExp(`^${pattern || ''}/?$`), keys, handlers });
    return this;
  }

  get(path, ...h) { return this.add('GET', path, ...h); }
  post(path, ...h) { return this.add('POST', path, ...h); }
  patch(path, ...h) { return this.add('PATCH', path, ...h); }
  delete(path, ...h) { return this.add('DELETE', path, ...h); }

  /** Returns { route, params } or { allowed: [...] } when only the method is wrong. */
  match(method, pathname) {
    const allowed = [];
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return { allowed };
  }
}

module.exports = Router;
