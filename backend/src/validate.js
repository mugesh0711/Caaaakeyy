'use strict';

const { HttpError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s-]{7,15}$/;

function str(value, { field, min = 1, max = 200, required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return '';
  }
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`, { field });
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`, { field });
  return v;
}

function email(value, field = 'Email') {
  const v = str(value, { field, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, 'Please enter a valid email address', { field: 'email' });
  return v;
}

function phone(value, field = 'Phone') {
  const v = str(value, { field, max: 20 });
  if (!PHONE_RE.test(v)) throw new HttpError(400, 'Please enter a valid phone number', { field: 'phone' });
  return v;
}

function int(value, { field, min = 1, max = 99 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`, { field });
  }
  return n;
}

module.exports = { str, email, phone, int, EMAIL_RE, PHONE_RE };
