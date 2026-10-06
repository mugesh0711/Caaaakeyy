/* =========================================================
   Contact form → POST /api/contact
   ========================================================= */
(function () {
    'use strict';

    const { api, toast, setLoading, showFieldErrors } = window.Cakey;
    const form = document.getElementById('contact-form');
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const PHONE_RE = /^[+]?[\d\s-]{7,15}$/;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        Object.keys(data).forEach((k) => { data[k] = data[k].trim(); });

        const errors = {};
        if (!data.firstName) errors.firstName = 'Please enter your first name';
        if (!EMAIL_RE.test(data.contact) && !PHONE_RE.test(data.contact)) errors.contact = 'Enter a valid email or phone number';
        if (data.message.length < 5) errors.message = 'Please write a little more';
        if (showFieldErrors(form, errors)) return;

        const btn = form.querySelector('[type="submit"]');
        setLoading(btn, true);
        try {
            const res = await api('POST', '/api/contact', data);
            btn.classList.add('is-sent');
            toast(res.message);
            form.reset();
            setTimeout(() => btn.classList.remove('is-sent'), 900);
        } catch (err) {
            if (err.details && err.details.field) showFieldErrors(form, { [err.details.field]: err.message });
            toast(err.message, 'error');
        } finally {
            setLoading(btn, false);
        }
    });
})();
