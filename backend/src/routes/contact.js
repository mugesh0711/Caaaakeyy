'use strict';

const db = require('../db');
const v = require('../validate');
const { HttpError, sendJson } = require('../http');
const rateLimit = require('../rateLimit');

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'You have sent a lot of messages. Please try again in a while.',
});

module.exports = function contactRoutes(router) {
  // POST /api/contact  { firstName, lastName?, contact, message }
  router.post('/api/contact', contactLimiter, async (req, res) => {
    const firstName = v.str(req.body.firstName, { field: 'First name', max: 40 });
    const lastName = v.str(req.body.lastName, { field: 'Last name', max: 40, required: false });
    const contact = v.str(req.body.contact, { field: 'Email or phone', max: 254 });
    const message = v.str(req.body.message, { field: 'Message', min: 5, max: 2000 });

    if (!v.EMAIL_RE.test(contact) && !v.PHONE_RE.test(contact)) {
      throw new HttpError(400, 'Please enter a valid email or phone number', { field: 'contact' });
    }

    const saved = await db.update((data) => {
      const msg = {
        id: db.newId('msg'),
        firstName,
        lastName,
        contact,
        message,
        createdAt: new Date().toISOString(),
      };
      data.messages.push(msg);
      return msg;
    });

    sendJson(res, 201, { ok: true, id: saved.id, message: `Thanks ${firstName}! We'll get back to you soon.` });
  });
};
