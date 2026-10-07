'use strict';

const db = require('../db');
const v = require('../validate');
const { HttpError, sendJson } = require('../http');
const { hashPassword, verifyPassword, signToken, requireAuth, publicUser } = require('../auth');
const rateLimit = require('../rateLimit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

module.exports = function authRoutes(router) {
  // POST /api/auth/register  { name, email, password }
  router.post('/api/auth/register', authLimiter, async (req, res) => {
    const name = v.str(req.body.name, { field: 'Name', min: 2, max: 60 });
    const email = v.email(req.body.email);
    const password = v.str(req.body.password, { field: 'Password', min: 6, max: 128 });

    const user = await db.update((data) => {
      if (data.users.some((u) => u.email === email)) {
        throw new HttpError(409, 'An account with this email already exists', { field: 'email' });
      }
      const created = {
        id: db.newId('usr'),
        name,
        email,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      data.users.push(created);
      return created;
    });

    sendJson(res, 201, { token: signToken({ sub: user.id }), user: publicUser(user) });
  });

  // POST /api/auth/login  { email, password }
  router.post('/api/auth/login', authLimiter, async (req, res) => {
    const email = v.email(req.body.email);
    const password = v.str(req.body.password, { field: 'Password', max: 128 });

    const user = (await db.read()).users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    sendJson(res, 200, { token: signToken({ sub: user.id }), user: publicUser(user) });
  });

  // GET /api/auth/me  -> the logged-in user
  router.get('/api/auth/me', requireAuth, async (req, res) => {
    sendJson(res, 200, { user: publicUser(req.user) });
  });
};
