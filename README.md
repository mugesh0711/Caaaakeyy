# 🎂 Caaaakeyy — Cake Shop (Full Stack)

A responsive cake-shop website with a Node.js backend.
Works on **mobile, tablet, laptop and desktop**.

## Run it

You only need **Node.js 18 or newer** — there are **no npm packages to install**.

```bash
cd backend
node server.js
```

Open **http://localhost:5000** — the same server gives you the website and the API.

> Using VS Code Live Server instead? That works too: keep `node server.js` running
> and the pages will call the API on port 5000 automatically.

Optional: copy `backend/.env.example` to `backend/.env` to change the port or set your own `JWT_SECRET`.

Run the API tests: `cd backend && npm test`

## What's inside

```
index.html / style.css      Home: hero, ticker, search, categories
menu.html  / menu.css       Menu: live search, category chips, sort, add to cart
about.html / about.css      About: story, animated counters
contact.html / contact.css  Contact: info + message form (saved by the API)
login.html / login.css      Log in
sign.html  / sign.css       Sign in / Join Us (create account) with sliding tabs
common.css                  Shared header, buttons, cart drawer, toasts, footer, animations
script.js                   Shared logic: API client, login session, cart, drawer, checkout, animations
menu.js, auth.js, contact.js   Page-specific logic
photo/opt/                  Compressed images used by the site (originals untouched in photo/)

backend/
  server.js                 Static file server + REST API (pure Node.js)
  src/routes/               auth, products, cart, orders, contact
  src/auth.js               scrypt password hashing + JWT login tokens
  src/db.js                 JSON-file database (data/db.json, created automatically)
  data/products.json        The cake catalogue (edit prices/cakes here)
  test/api.test.js          End-to-end API tests
```

## API

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | – | Server check |
| GET | `/api/products?q=&category=&sort=` | – | List / search / filter cakes |
| GET | `/api/products/:id` | – | One cake |
| GET | `/api/categories` | – | Category list |
| POST | `/api/auth/register` | – | `{name, email, password}` → token |
| POST | `/api/auth/login` | – | `{email, password}` → token |
| GET | `/api/auth/me` | ✔ | Logged-in user |
| GET | `/api/cart` | ✔ | Cart with totals |
| POST | `/api/cart/items` | ✔ | `{productId, qty}` add |
| PATCH | `/api/cart/items/:productId` | ✔ | `{qty}` set (0 removes) |
| DELETE | `/api/cart/items/:productId` | ✔ | Remove item |
| POST | `/api/cart/merge` | ✔ | Move guest cart into account after login |
| POST | `/api/orders` | ✔ | `{name, phone, address, note?}` checkout |
| GET | `/api/orders` | ✔ | My orders |
| POST | `/api/contact` | – | `{firstName, lastName?, contact, message}` |

✔ = send `Authorization: Bearer <token>`.

Prices are always taken from the server catalogue (never from the browser).
Delivery is free from Rs 999, otherwise Rs 49.

## Security notes

- Passwords hashed with scrypt + random salt; tokens signed with HMAC-SHA256.
- Login and contact endpoints are rate-limited.
- The server never serves `backend/`, `.git/` or other dot-files.
- Security headers (CSP, nosniff, frame-deny) on every response.
- `backend/data/db.json` and the generated secret are git-ignored — don't commit them.
