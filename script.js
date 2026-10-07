/* =========================================================
   Caaaakeyy — shared front-end logic (every page)
   - API client + login session
   - Cart (server cart when logged in, browser cart for guests)
   - Cart drawer + checkout
   - Mobile nav, ripple buttons, toasts, scroll reveal,
     counters, back-to-top
   ========================================================= */
(function () {
    'use strict';

    // ---------- API ----------

    // Same origin when served by the backend (http://localhost:5000).
    // When the page is opened from Live Server or as a file, talk to the backend directly.
    // On Vercel / Railway the API is on the same site, so the base is ''.
    const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    const API_BASE = (() => {
        const { protocol, hostname, port } = window.location;
        if (protocol === 'file:') return 'http://localhost:5000';
        if ((hostname === 'localhost' || hostname === '127.0.0.1') && port !== '5000') return 'http://localhost:5000';
        return '';
    })();
    const OFFLINE_MESSAGE = IS_LOCAL
        ? 'Cannot reach the server. Start it with "npm start" in the project folder.'
        : 'Cannot reach the server. Please check your internet connection and try again.';

    async function api(method, path, body) {
        const headers = {};
        if (body) headers['Content-Type'] = 'application/json';
        const token = Session.token();
        if (token) headers.Authorization = `Bearer ${token}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res;
        try {
            res = await fetch(API_BASE + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        } catch (e) {
            const err = new Error(OFFLINE_MESSAGE);
            err.offline = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || `Request failed (${res.status})`);
            err.status = res.status;
            err.details = data.details;
            if (res.status === 401 && token) Session.clear();
            throw err;
        }
        return data;
    }

    // ---------- Session (login state) ----------

    const TOKEN_KEY = 'cakey_token';
    const USER_KEY = 'cakey_user';

    const store = {
        get(key) {
            try { return localStorage.getItem(key) ?? sessionStorage.getItem(key); } catch { return null; }
        },
        set(key, value, persistent) {
            try { (persistent ? localStorage : sessionStorage).setItem(key, value); } catch { /* storage blocked */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* ignore */ }
        },
    };

    const Session = {
        token: () => store.get(TOKEN_KEY),
        user() {
            try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch { return null; }
        },
        isLoggedIn: () => Boolean(store.get(TOKEN_KEY)),
        save(token, user, remember = true) {
            store.remove(TOKEN_KEY);
            store.remove(USER_KEY);
            store.set(TOKEN_KEY, token, remember);
            store.set(USER_KEY, JSON.stringify(user), remember);
            renderAuthState();
        },
        clear() {
            store.remove(TOKEN_KEY);
            store.remove(USER_KEY);
            renderAuthState();
        },
    };

    function renderAuthState() {
        const user = Session.user();
        document.querySelectorAll('[data-auth="guest"]').forEach((el) => { el.hidden = Boolean(user); });
        document.querySelectorAll('[data-auth="user"]').forEach((el) => { el.hidden = !user; });
        document.querySelectorAll('[data-user-name]').forEach((el) => {
            el.textContent = user ? user.name.split(' ')[0] : '';
        });
    }

    // ---------- Products (API with static fallback) ----------

    let productCache = null;

    async function loadAllProducts() {
        if (productCache) return productCache;
        try {
            productCache = (await api('GET', '/api/products')).products;
        } catch (err) {
            // Backend offline (e.g. Live Server without "npm start"): read the catalog file directly.
            const res = await fetch('backend/data/products.json').catch(() => null);
            const list = res && res.ok ? await res.json().catch(() => null) : null;
            if (!Array.isArray(list)) throw err;
            productCache = list;
        }
        return productCache;
    }

    // ---------- Cart ----------

    const GUEST_CART_KEY = 'cakey_guest_cart';
    const FREE_DELIVERY_FROM = 999;
    const DELIVERY_FEE = 49;

    const Cart = {
        state: { items: [], count: 0, subtotal: 0, delivery: 0, total: 0, freeDeliveryFrom: FREE_DELIVERY_FROM },

        guestItems() {
            try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]'); } catch { return []; }
        },
        saveGuest(items) {
            try { localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items)); } catch { /* ignore */ }
        },

        async summarizeGuest(items) {
            const products = await loadAllProducts().catch(() => []);
            const lines = items
                .map(({ productId, qty }) => {
                    const p = products.find((x) => x.id === productId);
                    return p && { productId, name: p.name, image: p.image, price: p.price, qty, lineTotal: p.price * qty };
                })
                .filter(Boolean);
            const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
            const delivery = subtotal === 0 || subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
            return {
                items: lines,
                count: lines.reduce((s, l) => s + l.qty, 0),
                subtotal,
                delivery,
                total: subtotal + delivery,
                freeDeliveryFrom: FREE_DELIVERY_FROM,
            };
        },

        async refresh() {
            if (Session.isLoggedIn()) {
                try {
                    this.set(await api('GET', '/api/cart'));
                    return;
                } catch (err) {
                    if (err.status !== 401) { this.set(this.state); return; }
                }
            }
            this.set(await this.summarizeGuest(this.guestItems()));
        },

        set(summary) {
            const prevCount = this.state.count;
            this.state = summary;
            updateBadge(summary.count, summary.count > prevCount);
            document.dispatchEvent(new CustomEvent('cart:change', { detail: summary }));
            if (Drawer.isOpen()) Drawer.render();
        },

        async add(productId, qty = 1) {
            if (Session.isLoggedIn()) {
                this.set(await api('POST', '/api/cart/items', { productId, qty }));
            } else {
                const items = this.guestItems();
                const line = items.find((i) => i.productId === productId);
                if (line) line.qty = Math.min(20, line.qty + qty);
                else items.push({ productId, qty: Math.min(20, qty) });
                this.saveGuest(items);
                this.set(await this.summarizeGuest(items));
            }
        },

        async setQty(productId, qty) {
            if (Session.isLoggedIn()) {
                this.set(await api('PATCH', `/api/cart/items/${encodeURIComponent(productId)}`, { qty }));
            } else {
                let items = this.guestItems();
                if (qty <= 0) items = items.filter((i) => i.productId !== productId);
                else items.forEach((i) => { if (i.productId === productId) i.qty = Math.min(20, qty); });
                this.saveGuest(items);
                this.set(await this.summarizeGuest(items));
            }
        },

        remove(productId) {
            return this.setQty(productId, 0);
        },

        /** After login: move the guest cart into the account. */
        async mergeGuestIntoAccount() {
            const items = this.guestItems();
            if (items.length) {
                try {
                    this.set(await api('POST', '/api/cart/merge', { items }));
                    this.saveGuest([]);
                    return;
                } catch { /* keep guest cart if merge fails */ }
            }
            await this.refresh();
        },
    };

    function updateBadge(count, bump) {
        document.querySelectorAll('.cart-badge').forEach((badge) => {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.toggle('has-items', count > 0);
            if (bump) {
                badge.classList.remove('bump');
                void badge.offsetWidth; // restart animation
                badge.classList.add('bump');
            }
        });
        if (bump) {
            document.querySelectorAll('.cart-btn').forEach((btn) => {
                btn.classList.remove('shake');
                void btn.offsetWidth;
                btn.classList.add('shake');
            });
        }
    }

    // ---------- Helpers ----------

    const rupees = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const ICONS = {
        check: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        alert: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9.5"/></svg>',
        info: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 11v6M12 7.5v.5"/><circle cx="12" cy="12" r="9.5"/></svg>',
        close: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
        up: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>',
    };

    function toast(message, type = 'success', ms = 3200) {
        let stack = document.querySelector('.toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'toast-stack';
            stack.setAttribute('role', 'status');
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        const icon = type === 'error' ? ICONS.alert : type === 'info' ? ICONS.info : ICONS.check;
        el.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
        stack.appendChild(el);
        setTimeout(() => {
            el.classList.add('is-leaving');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        }, ms);
    }

    function setLoading(button, loading) {
        if (!button) return;
        button.classList.toggle('is-loading', loading);
        button.disabled = loading;
    }

    /** Animates a product image flying into the header cart button. */
    function flyToCart(sourceImg) {
        const target = [...document.querySelectorAll('.cart-btn')].find((b) => b.offsetParent);
        if (!sourceImg || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const from = sourceImg.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const size = Math.min(from.width, 90);
        const clone = document.createElement('img');
        clone.src = sourceImg.currentSrc || sourceImg.src;
        clone.className = 'fly-img';
        Object.assign(clone.style, {
            width: `${size}px`,
            height: `${size}px`,
            left: `${from.left + from.width / 2 - size / 2}px`,
            top: `${from.top + from.height / 2 - size / 2}px`,
        });
        document.body.appendChild(clone);
        requestAnimationFrame(() => {
            const dx = to.left + to.width / 2 - (from.left + from.width / 2);
            const dy = to.top + to.height / 2 - (from.top + from.height / 2);
            clone.style.transform = `translate(${dx}px, ${dy}px) scale(.15) rotate(360deg)`;
            clone.style.opacity = '.4';
        });
        clone.addEventListener('transitionend', () => clone.remove(), { once: true });
        setTimeout(() => clone.remove(), 1200);
    }

    // ---------- Cart drawer ----------

    const Drawer = {
        el: null,
        overlay: null,
        view: 'cart', // 'cart' | 'checkout' | 'done'
        lastOrder: null,

        build() {
            this.overlay = document.createElement('div');
            this.overlay.className = 'drawer-overlay';
            this.el = document.createElement('aside');
            this.el.className = 'cart-drawer';
            this.el.setAttribute('aria-label', 'Shopping cart');
            this.el.setAttribute('aria-hidden', 'true');
            this.el.innerHTML = `
                <div class="drawer-head">
                    <h2>Your Cart</h2>
                    <button class="icon-btn" type="button" data-close-drawer aria-label="Close cart">${ICONS.close}</button>
                </div>
                <div class="drawer-body"></div>
                <div class="drawer-foot"></div>`;
            document.body.append(this.overlay, this.el);

            this.overlay.addEventListener('click', () => this.close());
            this.el.addEventListener('click', (e) => this.onClick(e));
            this.el.addEventListener('submit', (e) => this.onSubmit(e));
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.close(); });
        },

        isOpen() {
            return this.el && this.el.classList.contains('is-open');
        },

        open() {
            if (!this.el) this.build();
            this.view = 'cart';
            this.render();
            this.el.classList.add('is-open');
            this.overlay.classList.add('is-open');
            this.el.setAttribute('aria-hidden', 'false');
            document.body.classList.add('no-scroll');
            setTimeout(() => this.el.querySelector('[data-close-drawer]').focus(), 100);
        },

        close() {
            if (!this.el) return;
            this.el.classList.remove('is-open');
            this.overlay.classList.remove('is-open');
            this.el.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('no-scroll');
        },

        render() {
            const body = this.el.querySelector('.drawer-body');
            const foot = this.el.querySelector('.drawer-foot');
            const s = Cart.state;

            if (this.view === 'done' && this.lastOrder) {
                const o = this.lastOrder;
                body.innerHTML = `
                    <div class="order-done">
                        <div class="check-circle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
                        <h3>Order placed!</h3>
                        <p>Thank you ${esc(o.customer.name)}. Your order <b>#${esc(o.id.slice(-6).toUpperCase())}</b>
                        of <b>${rupees(o.total)}</b> is being baked with love.</p>
                    </div>`;
                foot.innerHTML = `<button class="btn btn--block" type="button" data-close-drawer>Continue shopping</button>`;
                return;
            }

            if (!s.items.length) {
                body.innerHTML = `
                    <div class="cart-empty">
                        <img src="photo/cake (2).png" alt="">
                        <p>Your cart is empty.<br>Let's fix that!</p>
                        <a class="btn" href="menu.html">Browse the menu</a>
                    </div>`;
                foot.innerHTML = '';
                return;
            }

            if (this.view === 'checkout') {
                const user = Session.user() || {};
                body.innerHTML = `
                    <form class="checkout-form" novalidate>
                        <h3>Delivery details</h3>
                        <div class="field"><label for="co-name">Full name</label>
                            <input id="co-name" name="name" autocomplete="name" value="${esc(user.name || '')}" required>
                            <small class="field-error"></small></div>
                        <div class="field"><label for="co-phone">Phone</label>
                            <input id="co-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required>
                            <small class="field-error"></small></div>
                        <div class="field"><label for="co-address">Address</label>
                            <textarea id="co-address" name="address" rows="3" autocomplete="street-address" required></textarea>
                            <small class="field-error"></small></div>
                        <div class="field"><label for="co-note">Message on cake (optional)</label>
                            <input id="co-note" name="note" maxlength="300" placeholder="Happy Birthday Amma!"></div>
                        <button class="btn btn--block" type="submit">Place order · ${rupees(s.total)}</button>
                        <button class="link-btn" type="button" data-back>← Back to cart</button>
                    </form>`;
                foot.innerHTML = '';
                return;
            }

            body.innerHTML = `<ul class="cart-list">${s.items.map((i) => `
                <li class="cart-item" data-id="${esc(i.productId)}">
                    <img src="${esc(i.image)}" alt="" loading="lazy">
                    <div>
                        <h3>${esc(i.name)}</h3>
                        <div class="price">${rupees(i.price)} × ${i.qty} = <b>${rupees(i.lineTotal)}</b></div>
                        <div class="stepper" role="group" aria-label="Quantity">
                            <button type="button" data-qty="-1" aria-label="Decrease">−</button>
                            <output>${i.qty}</output>
                            <button type="button" data-qty="1" aria-label="Increase">+</button>
                        </div>
                    </div>
                    <button class="remove" type="button" data-remove aria-label="Remove ${esc(i.name)}">${ICONS.trash}</button>
                </li>`).join('')}</ul>`;

            const remaining = Math.max(0, s.freeDeliveryFrom - s.subtotal);
            const pct = Math.min(100, (s.subtotal / s.freeDeliveryFrom) * 100);
            foot.innerHTML = `
                <p class="free-note">${remaining > 0
                    ? `Add ${rupees(remaining)} more for <b>free delivery</b> 🛵`
                    : 'Yay! You get <b>free delivery</b> 🎉'}</p>
                <div class="progress"><span style="width:${pct}%"></span></div>
                <div class="summary-row"><span>Subtotal</span><span>${rupees(s.subtotal)}</span></div>
                <div class="summary-row"><span>Delivery</span><span>${s.delivery ? rupees(s.delivery) : 'Free'}</span></div>
                <div class="summary-row total"><span>Total</span><span>${rupees(s.total)}</span></div>
                <button class="btn btn--block" type="button" data-checkout>Checkout</button>`;
        },

        async onClick(e) {
            const t = e.target;
            if (t.closest('[data-close-drawer]')) return this.close();
            if (t.closest('[data-back]')) { this.view = 'cart'; return this.render(); }

            if (t.closest('[data-checkout]')) {
                if (!Session.isLoggedIn()) {
                    toast('Please sign in to place your order', 'info');
                    setTimeout(() => {
                        window.location.href = `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}&checkout=1`;
                    }, 700);
                    return;
                }
                this.view = 'checkout';
                return this.render();
            }

            const item = t.closest('.cart-item');
            if (!item) return;
            const id = item.dataset.id;
            const line = Cart.state.items.find((i) => i.productId === id);
            try {
                if (t.closest('[data-remove]')) {
                    item.classList.add('is-removing');
                    await new Promise((r) => setTimeout(r, 300));
                    await Cart.remove(id);
                    toast(`${line.name} removed`, 'info', 2000);
                } else if (t.closest('[data-qty]') && line) {
                    const next = line.qty + Number(t.closest('[data-qty]').dataset.qty);
                    if (next > 20) return toast('Maximum 20 per item', 'info');
                    await Cart.setQty(id, next);
                    const out = this.el.querySelector(`.cart-item[data-id="${CSS.escape(id)}"] output`);
                    if (out) out.classList.add('tick');
                }
            } catch (err) {
                toast(err.message, 'error');
            }
        },

        async onSubmit(e) {
            const form = e.target.closest('.checkout-form');
            if (!form) return;
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form));
            const errors = {};
            if (!data.name || data.name.trim().length < 2) errors.name = 'Please enter your name';
            if (!/^[+]?[\d\s-]{7,15}$/.test(data.phone || '')) errors.phone = 'Enter a valid phone number';
            if (!data.address || data.address.trim().length < 8) errors.address = 'Please enter your full address';
            if (showFieldErrors(form, errors)) return;

            const btn = form.querySelector('[type="submit"]');
            setLoading(btn, true);
            try {
                const { order } = await api('POST', '/api/orders', data);
                this.lastOrder = order;
                this.view = 'done';
                await Cart.refresh();
                this.render();
                toast('Order placed successfully!');
            } catch (err) {
                if (err.details && err.details.field) showFieldErrors(form, { [err.details.field]: err.message });
                toast(err.message, 'error');
            } finally {
                setLoading(btn, false);
            }
        },
    };

    /** Shows {fieldName: message} errors under inputs. Returns true when there are errors. */
    function showFieldErrors(form, errors) {
        form.querySelectorAll('.field').forEach((f) => {
            f.classList.remove('has-error');
            const small = f.querySelector('.field-error');
            if (small) small.textContent = '';
        });
        const names = Object.keys(errors);
        names.forEach((name) => {
            const input = form.querySelector(`[name="${name}"]`);
            const field = input && input.closest('.field');
            if (!field) return;
            field.classList.add('has-error');
            const small = field.querySelector('.field-error');
            if (small) small.textContent = errors[name];
        });
        if (names.length) {
            const first = form.querySelector(`[name="${names[0]}"]`);
            if (first) first.focus();
        }
        return names.length > 0;
    }

    // ---------- UI behaviour ----------

    function initNav() {
        const header = document.querySelector('.site-header');
        const toggle = document.querySelector('.nav-toggle');
        if (!header) return;

        const setOpen = (open) => {
            header.classList.toggle('nav-open', open);
            if (toggle) {
                toggle.setAttribute('aria-expanded', String(open));
                toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            }
        };

        if (toggle) {
            toggle.addEventListener('click', () => setOpen(!header.classList.contains('nav-open')));
            header.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
            document.addEventListener('click', (e) => {
                if (header.classList.contains('nav-open') && !header.contains(e.target)) setOpen(false);
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
            matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
        }

        const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
    }

    function initRipple() {
        document.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('.btn, .ripple-host');
            if (!btn || btn.disabled) return;
            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
            btn.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        });
    }

    function initReveal(root = document) {
        const items = root.querySelectorAll('.reveal:not(.is-visible)');
        if (!('IntersectionObserver' in window)) {
            items.forEach((el) => el.classList.add('is-visible'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
        items.forEach((el) => io.observe(el));
    }

    function initCounters() {
        const counters = document.querySelectorAll('[data-count]');
        if (!counters.length) return;
        const run = (el) => {
            const target = parseFloat(el.dataset.count);
            const decimals = (el.dataset.count.split('.')[1] || '').length;
            const suffix = el.dataset.suffix || '';
            const duration = 1600;
            const start = performance.now();
            const step = (now) => {
                const p = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - p, 3);
                el.textContent = (target * eased).toFixed(decimals) + suffix;
                if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
            });
        }, { threshold: 0.5 });
        counters.forEach((c) => io.observe(c));
    }

    function initToTop() {
        const btn = document.createElement('button');
        btn.className = 'to-top';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Back to top');
        btn.innerHTML = ICONS.up;
        document.body.appendChild(btn);
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        const onScroll = () => btn.classList.toggle('is-visible', window.scrollY > 500);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    function initFieldErrorReset() {
        document.addEventListener('input', (e) => {
            const field = e.target.closest('.field.has-error');
            if (!field) return;
            field.classList.remove('has-error');
            const small = field.querySelector('.field-error');
            if (small) small.textContent = '';
        });
    }

    function initGlobalActions() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-open-cart]')) {
                e.preventDefault();
                Drawer.open();
            }
            if (e.target.closest('[data-action="logout"]')) {
                Session.clear();
                Cart.refresh();
                toast('You have been logged out', 'info');
            }
            if (e.target.closest('[data-soon]')) {
                e.preventDefault();
                toast(`${e.target.closest('[data-soon]').dataset.soon} is coming soon!`, 'info');
            }
        });
    }

    // ---------- Home page ----------

    function initHome() {
        if (document.body.dataset.page !== 'home') return;
        const explore = document.querySelector('[data-scroll-to]');
        if (explore) {
            explore.addEventListener('click', () => {
                document.querySelector(explore.dataset.scrollTo).scrollIntoView({ behavior: 'smooth' });
            });
        }
        const form = document.querySelector('.search-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const q = form.querySelector('input').value.trim();
                window.location.href = q ? `menu.html?q=${encodeURIComponent(q)}` : 'menu.html';
            });
        }
    }

    // ---------- Boot ----------

    document.addEventListener('DOMContentLoaded', () => {
        renderAuthState();
        initNav();
        initRipple();
        initReveal();
        initCounters();
        initToTop();
        initGlobalActions();
        initFieldErrorReset();
        initHome();
        Cart.refresh();

        // Opened from login with ?cart=1 → show the cart straight away
        if (new URLSearchParams(location.search).get('cart') === '1') setTimeout(() => Drawer.open(), 400);
    });

    // Public helpers for page scripts (menu.js, auth.js, contact.js)
    window.Cakey = {
        api, Session, Cart, Drawer, toast, setLoading, flyToCart, showFieldErrors, IS_LOCAL, OFFLINE_MESSAGE,
        loadAllProducts, initReveal, rupees, esc, renderAuthState,
    };
})();
