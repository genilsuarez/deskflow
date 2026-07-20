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
    setUser(null);
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
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', isEdit ? 'Perfil de usuario' : 'Iniciar sesión');

    overlay.innerHTML = [
      '<div class="lp-login__card">',
      '  <button type="button" class="lp-icon-btn lp-login__close" aria-label="Cerrar"><span aria-hidden="true">&times;</span></button>',
      '  <div class="lp-login__hero">',
      '    <div class="lp-login__avatar" aria-hidden="true"><span class="lp-login__avatar-letter">' + initial + '</span></div>',
      '    <p class="lp-login__kicker">' + (isEdit ? 'LearnFlow Platform' : 'Primera vez aquí') + '</p>',
      '    <h2 class="lp-login__title">' + (isEdit ? 'Tu perfil' : 'Bienvenido') + '</h2>',
      '    <p class="lp-login__lede">' + (isEdit ? 'Actualiza cómo te verán las apps.' : 'Elige un nombre para personalizar tu experiencia.') + '</p>',
      '  </div>',
      '  <form class="lp-login__form">',
      '    <div class="lp-login__body">',
      '      <label class="lp-login__label" for="lp-login-name">Nombre</label>',
      '      <input class="lp-login__input" id="lp-login-name" type="text" autocomplete="name" spellcheck="false" placeholder="¿Cómo te llamas?" value="' + escapeAttr(user ? user.name : '') + '">',
      '      <p class="lp-login__hint" hidden></p>',
      '      <p class="lp-login__note">' + (isEdit ? 'Se muestra en DeskFlow, FluentFlow, HubFlow y LyricFlow.' : 'Se sincroniza en todas las apps de LearnFlow.') + '</p>',
      '    </div>',
      '    <footer class="lp-login__footer">',
      '      <button type="submit" class="lp-btn lp-btn--primary lp-login__submit">' + (isEdit ? 'Guardar cambios' : 'Continuar') + '</button>',
      isEdit ? '      <button type="button" class="lp-btn lp-btn--ghost lp-login__logout">Cerrar sesión</button>' : '',
      '    </footer>',
      '  </form>',
      '</div>'
    ].join('\n');

    overlay.querySelector('.lp-login__close').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    var form = overlay.querySelector('.lp-login__form');
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
      setUser({ id: (u && u.id) || String(Date.now()), name: trimmed });
      close();
    });

    var logoutBtn = overlay.querySelector('.lp-login__logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logout();
        close();
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
/* LP Login — profile modal (Learn Platform design system) */
.lp-login {
  position: fixed; inset: 0; z-index: 9999;
  background: color-mix(in srgb, var(--lp-ink, #2c2418) 38%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  animation: lp-login-in .24s ease-out;
  pointer-events: auto;
}
.lp-login--closing { animation: lp-login-out .18s ease-in forwards; }

.lp-login__card {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(calc(100vw - 2rem), 380px);
  max-height: min(
    88dvh,
    calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
  );
  background: var(--lp-surface, #fff);
  border: 1.5px solid var(--lp-border, #e8e0d4);
  border-radius: var(--lp-radius-xl, 20px);
  box-shadow: var(--lp-shadow-lg, 0 8px 28px rgba(44, 36, 24, 0.1), 0 2px 6px rgba(44, 36, 24, 0.05));
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  animation: lp-login-card-in .32s cubic-bezier(0.22, 0.9, 0.36, 1);
}
.lp-login--closing .lp-login__card {
  animation: lp-login-card-out .18s ease-in forwards;
}

.lp-login__close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  font-size: 1.15rem;
  line-height: 1;
}

.lp-login__hero {
  padding: 1.75rem 1.5rem 0.25rem;
  text-align: center;
}

.lp-login__avatar {
  width: 64px; height: 64px;
  margin: 0 auto 0.875rem;
  border-radius: 50%;
  display: grid; place-items: center;
  background: var(--lp-accent-soft, #e8f0fe);
  border: 2px solid color-mix(in srgb, var(--lp-accent, #2563eb) 22%, transparent);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--lp-accent, #2563eb) 14%, transparent);
}

.lp-login__avatar-letter {
  font-family: var(--lp-font-display, Georgia, serif);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--lp-accent, #2563eb);
  text-transform: uppercase;
  line-height: 1;
}

.lp-login__kicker {
  margin: 0 0 0.25rem;
  font-family: var(--lp-font-mono, monospace);
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lp-accent, #2563eb);
}

.lp-login__title {
  margin: 0;
  font-family: var(--lp-font-display, Georgia, serif);
  font-size: 1.35rem;
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--lp-ink, #2c2418);
}

.lp-login__lede {
  margin: 0.375rem 0 0;
  font-family: var(--lp-font-body, system-ui, sans-serif);
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--lp-ink-soft, #5e5041);
}

.lp-login__form { display: flex; flex-direction: column; }
.lp-login__body { padding: 1rem 1.5rem 0.25rem; }

.lp-login__label {
  display: block;
  margin-bottom: 0.375rem;
  font-family: var(--lp-font-body, system-ui, sans-serif);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__input {
  width: 100%;
  padding: 0.75rem 0.875rem;
  border: 1.5px solid var(--lp-border, #e8e0d4);
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
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--lp-error, #c0392b);
}
.lp-login__note {
  margin: 0.75rem 0 0;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__footer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.5rem 1.5rem;
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
.lp-login .lp-icon-btn {
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1.5px solid var(--lp-navbtn-border, var(--lp-border, #e8e0d4));
  background: var(--lp-navbtn-bg, var(--lp-surface, #fff));
  color: var(--lp-navbtn-icon-color, var(--lp-ink-soft, #5e5041));
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--lp-navbtn-shadow, var(--lp-shadow-sm));
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.lp-login .lp-icon-btn:hover {
  border-color: var(--lp-navbtn-accent, var(--lp-accent, #2563eb));
  transform: scale(1.06);
  box-shadow: var(--lp-navbtn-shadow-hover, var(--lp-shadow-hover));
}
.lp-login .lp-btn:focus-visible,
.lp-login .lp-icon-btn:focus-visible {
  outline: 2px solid var(--lp-accent, #2563eb);
  outline-offset: 2px;
}

/* Dark mode */
[data-theme="dark"] .lp-login,
html.dark .lp-login {
  background: color-mix(in srgb, #14171c 72%, transparent);
}
[data-theme="dark"] .lp-login__card,
html.dark .lp-login__card {
  background: var(--lp-surface, #252930);
  border-color: var(--lp-border, #353b45);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
}
[data-theme="dark"] .lp-login__avatar,
html.dark .lp-login__avatar {
  background: var(--lp-accent-soft, #1a2744);
  border-color: color-mix(in srgb, var(--lp-accent, #2563eb) 35%, transparent);
}
[data-theme="dark"] .lp-login__avatar-letter,
html.dark .lp-login__avatar-letter { color: #6b9fe8; }
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

@media (max-width: 640px) {
  .lp-login__card {
    width: min(calc(100vw - 1.5rem), 380px);
    max-height: min(
      90dvh,
      calc(100dvh - 1.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
    );
  }
  .lp-login__hero { padding-top: 1.5rem; }
  .lp-login__footer { padding-bottom: max(1.25rem, env(safe-area-inset-bottom)); }
}

@keyframes lp-login-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lp-login-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lp-login-card-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 14px)); }
  to { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes lp-login-card-out {
  from { opacity: 1; transform: translate(-50%, -50%); }
  to { opacity: 0; transform: translate(-50%, calc(-50% + 10px)); }
}

@media (prefers-reduced-motion: reduce) {
  .lp-login, .lp-login__card, .lp-login--closing, .lp-login--closing .lp-login__card { animation: none !important; }
  .lp-login .lp-btn:hover, .lp-login .lp-icon-btn:hover { transform: none; }
  .lp-login__card { transform: translate(-50%, -50%); }
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

  return { getUser: getUser, setUser: setUser, logout: logout, open: open, close: close, onUpdate: onUpdate };
})();
