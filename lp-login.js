/**
 * LP Login — Cross-app login modal for LearnFlow Platform.
 * Shared key: localStorage 'lp-user' → { id, name } | null
 *
 * Usage:
 *   <script src="lp-login.js"></script>
 *   Then call: lpLogin.open()  / lpLogin.getUser() / lpLogin.onUpdate(callback)
 */
/* eslint-disable no-var */
var lpLogin = (function () {
  'use strict';

  var STORAGE_KEY = 'lp-user';
  var listeners = [];
  var modalEl = null;
  var stylesInjected = false;

  function getUser() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setUser(user) {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify(user);
  }

  function logout() {
    var user = getUser();
    var wasCloud = user && user.isSupabaseUser;
    if (window.lpSupabase && window.lpSupabase.signOut) {
      window.lpSupabase.signOut();
    }
    setUser(null);
    if (wasCloud && window.lpGuestReset && window.lpGuestReset.clearGuestLocalProgress) {
      window.lpGuestReset.clearGuestLocalProgress();
    }
  }

  function setUserFromSupabase(user, profile) {
    var fallbackName = (user.email || '').split('@')[0];
    setUser({
      id: user.id,
      name: (profile && profile.name) || fallbackName,
      email: user.email,
      isSupabaseUser: true
    });
  }

  function onUpdate(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  function open() {
    injectStyles();
    if (modalEl) { modalEl.remove(); modalEl = null; }
    modalEl = buildModal();
    document.body.appendChild(modalEl);
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var input = modalEl.querySelector('.lp-login__input');
      if (input) input.focus();
    }, 80);
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.add('lp-login--closing');
    document.body.style.overflow = '';
    setTimeout(function () { if (modalEl) { modalEl.remove(); modalEl = null; } }, 200);
  }

  function notify(user) {
    listeners.forEach(function (fn) { fn(user); });
  }

  function buildModal() {
    var user = getUser();
    var isEdit = !!user;
    var initial = (user && user.name) ? user.name[0].toUpperCase() : '?';

    var overlay = document.createElement('div');
    overlay.className = 'lp-login';
    overlay.setAttribute('role', 'presentation');

    overlay.innerHTML = [
      '<section class="lp-login__card" role="dialog" aria-modal="true" aria-labelledby="lp-login-title">',
      '  <header class="lp-login__header">',
      '    <div class="lp-login__identity" aria-hidden="true"><span class="lp-login__avatar-letter">' + initial + '</span></div>',
      '    <div class="lp-login__header-text">',
      '      <p class="lp-login__eyebrow">' + (isEdit ? 'LearnFlow · Plataforma' : 'Primera vez aquí') + '</p>',
      '      <h2 class="lp-login__title" id="lp-login-title">' + (isEdit ? 'Tu perfil' : 'Bienvenido') + '</h2>',
      '    </div>',
      '    <button type="button" class="lp-login__close" aria-label="Cerrar"><span aria-hidden="true">✕</span></button>',
      '  </header>',
      '  <div class="lp-login__body">',
      '    <p class="lp-login__lede">' + (isEdit ? 'Actualiza cómo te verán las apps.' : 'Elige un nombre para personalizar tu experiencia.') + '</p>',
      '    <form class="lp-login__form">',
      '      <label class="lp-login__label" for="lp-login-name">Nombre</label>',
      '      <input class="lp-login__input" id="lp-login-name" type="text" autocomplete="name" spellcheck="false" placeholder="¿Cómo te llamas?" value="' + escapeAttr(user ? user.name : '') + '">',
      '      <p class="lp-login__hint" hidden></p>',
      '      <p class="lp-login__note">' + (isEdit ? 'Se muestra en DeskFlow, FluentFlow, HubFlow y LyricFlow.' : 'Se sincroniza en todas las apps de LearnFlow.') + '</p>',
      '    </form>',
      (user && user.isSupabaseUser)
        ? '    <p class="lp-login__note lp-login__account">Progreso conectado a la nube como <strong>' + escapeAttr(user.email || '') + '</strong>.</p>'
        : [
          '    <div class="lp-login__divider"><span>o</span></div>',
          '    <div class="lp-login__cloud">',
          '      <button type="button" class="lp-btn lp-btn--ghost lp-login__google">Continuar con Google</button>',
          '      <form class="lp-login__magic-form">',
          '        <input class="lp-login__input lp-login__magic-input" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="tu@email.com">',
          '        <button type="submit" class="lp-btn lp-btn--ghost lp-login__magic-submit">Enviar enlace mágico</button>',
          '      </form>',
          '      <p class="lp-login__magic-status" hidden></p>',
          '      <p class="lp-login__note">Guarda tu progreso en la nube y accede desde cualquier dispositivo.</p>',
          '    </div>'
        ].join('\n'),
      '  </div>',
      '  <footer class="lp-login__footer">',
      '    <button type="submit" form="lp-login-form" class="lp-btn lp-btn--primary lp-login__submit">' + (isEdit ? 'Guardar cambios' : 'Continuar') + '</button>',
      isEdit ? '    <button type="button" class="lp-btn lp-btn--ghost lp-login__logout">Cerrar sesión</button>' : '',
      '  </footer>',
      '</section>'
    ].join('\n');

    var form = overlay.querySelector('.lp-login__form');
    form.id = 'lp-login-form';

    overlay.querySelector('.lp-login__close').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    var input = overlay.querySelector('.lp-login__input');
    var hint = overlay.querySelector('.lp-login__hint');
    var avatarLetter = overlay.querySelector('.lp-login__avatar-letter');

    input.addEventListener('input', function () {
      var val = input.value.trim();
      avatarLetter.textContent = val ? val[0].toUpperCase() : '?';
      if (val.length >= 2) { hint.hidden = true; input.classList.remove('lp-login__input--error'); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var trimmed = input.value.trim();
      if (trimmed.length < 2) {
        hint.textContent = 'Mínimo 2 caracteres';
        hint.hidden = false;
        input.classList.add('lp-login__input--error');
        input.focus();
        return;
      }
      var u = getUser();
      var nextUser = { id: (u && u.id) || String(Date.now()), name: trimmed };
      if (u && u.isSupabaseUser) {
        nextUser.isSupabaseUser = true;
        if (u.email) nextUser.email = u.email;
      }
      setUser(nextUser);
      close();
    });

    var logoutBtn = overlay.querySelector('.lp-login__logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logout();
        close();
      });
    }

    var googleBtn = overlay.querySelector('.lp-login__google');
    if (googleBtn) {
      googleBtn.addEventListener('click', function () {
        if (!(window.lpSupabase && window.lpSupabase.signInWithGoogle)) return;
        googleBtn.disabled = true;
        window.lpSupabase.signInWithGoogle().catch(function () {
          googleBtn.disabled = false;
        });
      });
    }

    var magicForm = overlay.querySelector('.lp-login__magic-form');
    if (magicForm) {
      magicForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!(window.lpSupabase && window.lpSupabase.signInWithMagicLink)) return;
        var magicInput = magicForm.querySelector('.lp-login__magic-input');
        var status = overlay.querySelector('.lp-login__magic-status');
        var email = magicInput.value.trim();
        if (!email) return;
        var submitBtn = magicForm.querySelector('.lp-login__magic-submit');
        submitBtn.disabled = true;
        window.lpSupabase.signInWithMagicLink(email).then(function (res) {
          submitBtn.disabled = false;
          status.hidden = false;
          status.textContent = res.error
            ? 'No se pudo enviar el enlace: ' + res.error.message
            : 'Revisa tu correo — te enviamos un enlace para entrar.';
        });
      });
    }

    var escHandler = function (e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    return overlay;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function injectStyles() {
    var css = `
/* LP Login — profile modal (Learn Platform design system v2) */
.lp-login {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--lp-ink, #2c2418) 45%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: lp-login-in 0.2s ease-out both;
  pointer-events: auto;
}
.lp-login--closing { animation: lp-login-out 0.18s ease-in forwards; }

[data-theme="dark"] .lp-login,
html.dark .lp-login {
  background: color-mix(in srgb, #14171c 55%, transparent);
}

.lp-login__card {
  position: relative;
  width: min(100%, 420px);
  max-height: min(680px, calc(100svh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lp-border, #e8e0d4);
  border-radius: var(--lp-radius-lg, 16px);
  background: var(--lp-bg-paper, var(--lp-surface, #fff));
  box-shadow:
    0 24px 48px color-mix(in srgb, var(--lp-ink, #2c2418) 18%, transparent),
    0 4px 12px color-mix(in srgb, var(--lp-ink, #2c2418) 8%, transparent);
  color: var(--lp-ink-soft, #5e5041);
  animation: lp-login-card-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.lp-login--closing .lp-login__card {
  animation: lp-login-card-out 0.18s ease-in forwards;
}

.lp-login__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--lp-border, #e8e0d4);
  flex-shrink: 0;
}

.lp-login__header-text {
  flex: 1;
  min-width: 0;
}

.lp-login__identity {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--lp-accent, #2563eb);
  color: var(--lp-ink-inverse, #fff);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--lp-accent, #2563eb) 22%, transparent);
}

.lp-login__avatar-letter {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  text-transform: uppercase;
  line-height: 1;
}

.lp-login__eyebrow {
  margin: 0 0 2px;
  color: var(--lp-muted, #9c8e7c);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lp-login__title {
  margin: 0;
  font-family: var(--lp-font-display, Georgia, serif);
  font-size: 18px;
  font-weight: 500;
  line-height: 1.1;
  color: var(--lp-ink, #2c2418);
}

.lp-login__close {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  margin: -4px -6px -4px 0;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--lp-radius-full, 999px);
  background: transparent;
  color: var(--lp-muted, #9c8e7c);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.lp-login__close:hover {
  background: color-mix(in srgb, var(--lp-ink, #2c2418) 6%, transparent);
  color: var(--lp-ink, #2c2418);
}
.lp-login__close:active { transform: scale(0.97); }
.lp-login__close:focus-visible {
  outline: 2px solid var(--lp-accent, #2563eb);
  outline-offset: 2px;
}

.lp-login__body {
  padding: 12px 16px 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.lp-login__lede {
  margin: 0 0 14px;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__form { display: block; }

.lp-login__label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--lp-border, #e8e0d4);
  border-radius: var(--lp-radius-md, 10px);
  background: var(--lp-surface-sunken, #f0ede7);
  color: var(--lp-ink, #2c2418);
  font-family: var(--lp-font-body, system-ui, sans-serif);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}
.lp-login__input::placeholder { color: var(--lp-muted, #9c8e7c); }
.lp-login__input:focus {
  background: var(--lp-surface, #fff);
  border-color: var(--lp-accent, #2563eb);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lp-accent, #2563eb) 14%, transparent);
}
.lp-login__input--error { border-color: var(--lp-error, #c0392b); }
.lp-login__input--error:focus {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lp-error, #c0392b) 12%, transparent);
}

.lp-login__hint {
  margin: 6px 0 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--lp-error, #c0392b);
}
.lp-login__note {
  margin: 10px 0 0;
  font-size: 0.68rem;
  line-height: 1.45;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 14px;
  color: var(--lp-muted, #9c8e7c);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.lp-login__divider::before,
.lp-login__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--lp-border, #e8e0d4);
}

.lp-login__cloud { display: flex; flex-direction: column; gap: 10px; }

.lp-login__google { width: 100%; }

.lp-login__magic-form {
  display: flex;
  gap: 8px;
}
.lp-login__magic-form .lp-login__input { flex: 1; }
.lp-login__magic-submit { flex: 0 0 auto; white-space: nowrap; }

.lp-login__magic-status {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--lp-muted, #9c8e7c);
}

@media (max-width: 420px) {
  .lp-login__magic-form { flex-direction: column; }
}

.lp-login__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--lp-border, #e8e0d4);
  flex-shrink: 0;
}

.lp-login__submit,
.lp-login__logout { width: 100%; }

.lp-login__logout:hover {
  color: var(--lp-error, #c0392b);
  border-color: color-mix(in srgb, var(--lp-error, #c0392b) 28%, transparent);
}

/* LP button primitives (self-contained when buttons.css is absent) */
.lp-login .lp-btn {
  font-family: var(--lp-font-body, system-ui, sans-serif);
  font-weight: 700;
  font-size: 0.8125rem;
  min-height: 44px;
  padding: 10px 18px;
  border-radius: var(--lp-radius-md, 10px);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: transform 0.2s cubic-bezier(0.22, 0.9, 0.36, 1), box-shadow 0.2s, border-color 0.2s, color 0.2s;
}
.lp-login .lp-btn:hover { transform: translateY(-2px); }
.lp-login .lp-btn:active { transform: translateY(0) scale(0.97); }
.lp-login .lp-btn--primary {
  background: var(--lp-accent, #2563eb);
  color: var(--lp-ink-inverse, #fff);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--lp-accent, #2563eb) 25%, transparent);
}
.lp-login .lp-btn--ghost {
  background: var(--lp-surface, #fff);
  color: var(--lp-ink-soft, #5e5041);
  border: 1.5px solid var(--lp-border, #e8e0d4);
  box-shadow: none;
}
.lp-login .lp-btn:focus-visible {
  outline: 2px solid var(--lp-accent, #2563eb);
  outline-offset: 2px;
}

/* Dark mode */
[data-theme="dark"] .lp-login__card,
html.dark .lp-login__card {
  background: var(--lp-bg-paper, var(--lp-surface, #252930));
  border-color: var(--lp-border, #353b45);
}
[data-theme="dark"] .lp-login__input,
html.dark .lp-login__input {
  background: var(--lp-surface-sunken, #14171c);
  border-color: var(--lp-border, #353b45);
  color: var(--lp-ink, #e8eaed);
}
[data-theme="dark"] .lp-login__input:focus,
html.dark .lp-login__input:focus {
  background: var(--lp-surface-raised, #2b3038);
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px color-mix(in srgb, #60a5fa 16%, transparent);
}
[data-theme="dark"] .lp-login .lp-btn--ghost,
html.dark .lp-login .lp-btn--ghost {
  background: var(--lp-surface-raised, #2b3038);
  border-color: var(--lp-border, #353b45);
  color: var(--lp-ink-soft, #a8b0bc);
}

@media (max-width: 580px) {
  .lp-login { padding: 16px; }
  .lp-login__footer { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
}

@keyframes lp-login-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lp-login-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lp-login-card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes lp-login-card-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(10px) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .lp-login, .lp-login__card, .lp-login--closing, .lp-login--closing .lp-login__card { animation: none !important; }
  .lp-login .lp-btn:hover { transform: none; }
}
`;
    var legacy = document.getElementById('lp-login-styles');
    if (legacy) legacy.remove();
    var style = document.getElementById('lp-login-styles-v2');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lp-login-styles-v2';
      document.head.appendChild(style);
    }
    style.textContent = css;
    stylesInjected = true;
  }

  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      var user = e.newValue ? JSON.parse(e.newValue) : null;
      notify(user);
    }
  });

  return {
    getUser: getUser,
    setUser: setUser,
    setUserFromSupabase: setUserFromSupabase,
    logout: logout,
    open: open,
    close: close,
    onUpdate: onUpdate
  };
})();
