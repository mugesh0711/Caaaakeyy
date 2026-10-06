/* =========================================================
   Login (login.html) and Sign in / Join (sign.html)
   ========================================================= */
(function () {
    'use strict';

    const { api, Session, Cart, toast, setLoading, showFieldErrors } = window.Cakey;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const params = new URLSearchParams(location.search);

    // Where to go after logging in (only allow local pages)
    function nextUrl() {
        const next = params.get('next') || 'index.html';
        const safe = /^[\w-]+\.html$/.test(next) ? next : 'index.html';
        return params.get('checkout') ? `${safe}?cart=1` : safe;
    }

    // Keep ?next=…&checkout=1 when switching between login.html and sign.html
    if (location.search) {
        document.querySelectorAll('a[href^="sign.html"], a[href^="login.html"]').forEach((a) => {
            const [page, hash] = a.getAttribute('href').split('#');
            a.setAttribute('href', `${page}${location.search}${hash ? `#${hash}` : ''}`);
        });
    }

    // ---- password show/hide ----
    document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.querySelector('img').src = show ? 'photo/hidden.png' : 'photo/eye.png';
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            btn.classList.remove('flip');
            void btn.offsetWidth;
            btn.classList.add('flip');
        });
    });

    // ---- sign.html: switch between Sign In and Join Us ----
    const signForm = document.getElementById('sign-form');

    function setMode(mode) {
        if (!signForm) return;
        signForm.dataset.mode = mode;
        const register = mode === 'register';
        document.querySelector('.tabs').classList.toggle('is-register', register);
        document.querySelectorAll('.tab').forEach((t) => {
            const active = t.dataset.setMode === mode;
            t.classList.toggle('is-active', active);
            t.setAttribute('aria-selected', String(active));
        });
        signForm.querySelectorAll('[data-register-only]').forEach((el) => { el.hidden = !register; });
        signForm.querySelectorAll('[data-login-only]').forEach((el) => { el.hidden = register; });
        const title = signForm.querySelector('[data-title]');
        title.textContent = register ? 'Create Account' : 'Sign In';
        title.classList.remove('swap');
        void title.offsetWidth;
        title.classList.add('swap');
        signForm.querySelector('[data-submit-label]').textContent = register ? 'Join Us' : 'Sign In';
        signForm.querySelector('[name="password"]').autocomplete = register ? 'new-password' : 'current-password';
        showFieldErrors(signForm, {});
        history.replaceState(null, '', register ? '#join' : location.pathname + location.search);
    }

    document.querySelectorAll('[data-set-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.setMode)));
    if (signForm && location.hash === '#join') setMode('register');

    // ---- submit (both pages) ----
    document.querySelectorAll('.auth-form').forEach((form) => {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mode = form.dataset.mode;
            const data = Object.fromEntries(new FormData(form));
            const remember = Boolean(form.querySelector('[name="remember"]')?.checked);

            const errors = {};
            if (mode === 'register' && (!data.name || data.name.trim().length < 2)) errors.name = 'Please enter your name';
            if (!EMAIL_RE.test((data.email || '').trim())) errors.email = 'Please enter a valid email';
            if (!data.password) errors.password = 'Please enter your password';
            else if (mode === 'register' && data.password.length < 6) errors.password = 'Use at least 6 characters';
            if (showFieldErrors(form, errors)) return;

            const btn = form.querySelector('[type="submit"]');
            setLoading(btn, true);
            try {
                const body = { email: data.email.trim(), password: data.password };
                if (mode === 'register') body.name = data.name.trim();
                const res = await api('POST', mode === 'register' ? '/api/auth/register' : '/api/auth/login', body);
                Session.save(res.token, res.user, remember);
                await Cart.mergeGuestIntoAccount();
                toast(mode === 'register' ? `Welcome to Caaaakeyy, ${res.user.name.split(' ')[0]}! 🎉` : `Welcome back, ${res.user.name.split(' ')[0]}!`);
                btn.textContent = '✓';
                setTimeout(() => { window.location.href = nextUrl(); }, 900);
            } catch (err) {
                const field = err.details && err.details.field;
                if (field) showFieldErrors(form, { [field]: err.message });
                else if (err.status === 401) showFieldErrors(form, { password: err.message });
                toast(err.message, 'error');
                setLoading(btn, false);
            }
        });
    });

    // Already logged in? Let them know.
    if (Session.isLoggedIn()) {
        const user = Session.user();
        toast(`You're already signed in as ${user ? user.name : 'a user'}`, 'info');
    }
})();
