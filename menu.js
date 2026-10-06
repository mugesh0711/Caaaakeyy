/* =========================================================
   Menu page: load products, search, filter, sort, add to cart
   ========================================================= */
(function () {
    'use strict';

    const { loadAllProducts, Cart, toast, flyToCart, initReveal, rupees, esc } = window.Cakey;

    const grid = document.getElementById('product-grid');
    const empty = document.getElementById('empty-state');
    const countEl = document.getElementById('result-count');
    const search = document.getElementById('menu-search');
    const sortSel = document.getElementById('menu-sort');
    const chips = document.querySelectorAll('.chip');

    const params = new URLSearchParams(location.search);
    const state = {
        q: params.get('q') || '',
        category: params.get('category') || 'all',
        sort: params.get('sort') || '',
    };
    let products = [];

    const CART_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6.2"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>';
    const CHECK_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

    function filtered() {
        const q = state.q.trim().toLowerCase();
        let list = products.filter((p) =>
            (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) &&
            (state.category === 'all' || p.categories.includes(state.category)));
        if (state.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
        if (state.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
        if (state.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    function card(p, i) {
        return `
            <article class="items reveal" data-id="${esc(p.id)}" style="--delay:${(i % 4) * 0.08}s">
                <div class="img">
                    <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="460" height="400">
                    ${p.bestseller ? '<span class="badge">Bestseller</span>' : ''}
                </div>
                <div class="item-body">
                    <div class="itemnames">
                        <h3>${esc(p.name)}</h3>
                        <span class="price">${rupees(p.price)}</span>
                    </div>
                    <p class="desc">${esc(p.description)}</p>
                    <div class="addquantity">
                        <div class="stepper" role="group" aria-label="Quantity for ${esc(p.name)}">
                            <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
                            <span aria-live="polite">1</span>
                            <button type="button" data-step="1" aria-label="Increase quantity">+</button>
                        </div>
                        <button class="btn btn--sm add" type="button">${CART_ICON}<span>Add To Cart</span></button>
                    </div>
                </div>
            </article>`;
    }

    function render() {
        const list = filtered();
        grid.setAttribute('aria-busy', 'false');
        grid.innerHTML = list.map(card).join('');
        empty.hidden = list.length > 0;
        countEl.textContent = `${list.length} ${list.length === 1 ? 'cake' : 'cakes'}${state.q ? ` for “${state.q}”` : ''}`;
        initReveal(grid);
    }

    function syncUrl() {
        const p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.category !== 'all') p.set('category', state.category);
        if (state.sort) p.set('sort', state.sort);
        history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
    }

    function setCategory(cat) {
        state.category = cat;
        chips.forEach((c) => {
            const active = c.dataset.category === cat;
            c.classList.toggle('is-active', active);
            c.setAttribute('aria-pressed', String(active));
        });
    }

    // ---- events ----

    let debounce;
    search.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            state.q = search.value;
            syncUrl();
            render();
        }, 200);
    });

    chips.forEach((chip) => chip.addEventListener('click', () => {
        setCategory(chip.dataset.category);
        syncUrl();
        render();
        chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }));

    sortSel.addEventListener('change', () => {
        state.sort = sortSel.value;
        syncUrl();
        render();
    });

    document.getElementById('reset-filters').addEventListener('click', () => {
        state.q = '';
        search.value = '';
        state.sort = '';
        sortSel.value = '';
        setCategory('all');
        syncUrl();
        render();
    });

    grid.addEventListener('click', async (e) => {
        const article = e.target.closest('.items');
        if (!article) return;
        const qtyEl = article.querySelector('.stepper span');

        const step = e.target.closest('[data-step]');
        if (step) {
            const next = Math.min(20, Math.max(1, Number(qtyEl.textContent) + Number(step.dataset.step)));
            qtyEl.textContent = next;
            qtyEl.classList.remove('tick');
            void qtyEl.offsetWidth;
            qtyEl.classList.add('tick');
            return;
        }

        const addBtn = e.target.closest('.add');
        if (addBtn && !addBtn.classList.contains('is-loading')) {
            const product = products.find((p) => p.id === article.dataset.id);
            const qty = Number(qtyEl.textContent);
            addBtn.classList.add('is-loading');
            try {
                await Cart.add(product.id, qty);
                flyToCart(article.querySelector('.img img'));
                addBtn.classList.add('is-added');
                addBtn.innerHTML = `${CHECK_ICON}<span>Added</span>`;
                toast(`${qty} × ${product.name} added to cart`);
                qtyEl.textContent = '1';
                setTimeout(() => {
                    addBtn.classList.remove('is-added');
                    addBtn.innerHTML = `${CART_ICON}<span>Add To Cart</span>`;
                }, 1600);
            } catch (err) {
                toast(err.message, 'error');
            } finally {
                addBtn.classList.remove('is-loading');
            }
        }
    });

    // ---- start ----

    search.value = state.q;
    sortSel.value = state.sort;
    setCategory(state.category);

    loadAllProducts()
        .then((list) => {
            products = list;
            render();
        })
        .catch(() => {
            grid.innerHTML = '';
            grid.setAttribute('aria-busy', 'false');
            empty.hidden = false;
            empty.querySelector('h2').textContent = 'Menu could not load';
            empty.querySelector('p').textContent = 'Start the backend with "node backend/server.js" and open http://localhost:5000';
            empty.querySelector('button').hidden = true;
        });
})();
