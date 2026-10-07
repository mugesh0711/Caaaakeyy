# 🎂 Caaaakeyy — Cake Shop (Full Stack)

A responsive cake-shop website with a Node.js backend.
Works on **mobile, tablet, laptop and desktop**, and deploys to **Vercel** or **Railway**
with the backend running automatically — no npm packages, no build step.

## How the backend runs

| Where | What runs the backend | You do |
|---|---|---|
| **Vercel** | `api/index.js` runs as a serverless function for every `/api/...` request | Nothing — just deploy |
| **Railway / Render** | `npm start` → `backend/server.js` (website + API in one server) | Nothing — just deploy |
| **Your computer** | `npm start` → `backend/server.js` | Run `npm start`, open http://localhost:5000 |

All three use the same API code in `backend/src/app.js`.

## Deploy to Vercel (recommended)

1. Push this folder to GitHub (see *Updating GitHub* below).
2. On [vercel.com/new](https://vercel.com/new), import the repository and click **Deploy**.
   Don't change any settings — `vercel.json` already sets everything
   (Framework: Other, no build command, Root Directory empty).
3. Open `https://<your-project>.vercel.app/api/health` — you should see `"ok":true`.

**Keep accounts and orders permanently (free, ~1 minute):**
without a database, Vercel stores data temporarily and it resets whenever Vercel
restarts the function (health shows `"storage":"temporary"`).

4. In your Vercel project open **Storage**, create an **Upstash Redis** database (free plan)
   and connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
5. Go to **Deployments** → latest → **Redeploy**.
6. `/api/health` now shows `"storage":"redis"` — data is permanent.

## Deploy to Railway

1. New Project → Deploy from GitHub repo → pick this repo.
2. **Settings → Root Directory** must be empty (the project root, not `backend`).
3. **Settings → Networking → Generate Domain** — this is the link to your site.
4. Railway wipes files on every redeploy, so to keep data either add the two Upstash
   variables (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) in **Variables**,
   or attach a **Volume** mounted at `/data` and add the variable `DATA_DIR=/data`.

The `npm warn config production` line in Railway logs is harmless.

## Run it on your computer

You only need **Node.js 18 or newer**. From the project folder:

```bash
npm start
```

Open **http://localhost:5000** — the same server gives you the website and the API.
(Using VS Code Live Server? Keep `npm start` running; the pages call port 5000 automatically.)

Run the tests: `npm test`

## Updating GitHub

```bash
git add .
git commit -m "Backend runs automatically on Vercel and Railway"
git push
```

Vercel and Railway redeploy by themselves after every push.

## Settings (environment variables, all optional)

| Variable | What it does |
|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash Redis from Vercel's Storage tab (prefixed names like `CAKE_KV_REST_API_URL` also work) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Same, copied from the Upstash console |
| `JWT_SECRET` | Key for login tokens (32+ characters). If missing, one is generated and stored in the database |
| `TOKEN_TTL_HOURS` | How long a login lasts (default 168 = 7 days) |
| `DATA_DIR` | Folder for the JSON database when not using Redis |
| `PORT` | Port for `npm start` (default 5000; Railway sets it for you) |

On your computer you can put these in `backend/.env` (see `backend/.env.example`).

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

package.json                npm start / npm test (no dependencies)
vercel.json                 Vercel: send /api/* to api/index.js, hide backend/, security headers
api/index.js                Vercel serverless entry point

backend/
  server.js                 Website + API server for your computer / Railway
  src/app.js                The API (routing, CORS, errors) shared by both entry points
  src/db.js                 Storage: JSON file, or Upstash Redis over HTTPS
  src/config.js             Reads environment variables, picks the storage
  src/routes/               auth, products, cart, orders, contact
  src/auth.js               scrypt password hashing + JWT login tokens
  data/products.json        The cake catalogue (edit prices/cakes here)
  test/                     API tests + Vercel/Redis deployment tests
```

## API

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | – | Server check (also shows the storage in use) |
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
- Login and contact endpoints are rate-limited per visitor (real IP is read from the Vercel/Railway proxy).
- Saving to Redis uses compare-and-set, so two servers writing at once never lose an order or cart change.
- `backend/` source and data are never served as web pages; `.env`, `db.json` and the generated secret are git-ignored.
- Security headers (CSP, nosniff, frame-deny) on every response, also on Vercel via `vercel.json`.
