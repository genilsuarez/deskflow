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

  // ─── Public API ───

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
    if (!stylesInjected) injectStyles();
    if (modalEl) { modalEl.remove(); modalEl = null; }
    modalEl = buildModal();
    document.body.appendChild(modalEl);
    setTimeout(function () {
      var input = modalEl.querySelector('.lp-login__input');
      if (input) input.focus();
    }, 80);
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.add('lp-login--closing');
    setTimeout(function () { if (modalEl) { modalEl.remove(); modalEl = null; } }, 180);
  }

  // ─── Internal ───

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
      '  <header class="lp-login__header">',
      '    <h2 class="lp-login__title">' + (isEdit ? 'Tu Perfil' : 'Bienvenido') + '</h2>',
      '    <button type="button" class="lp-login__close" aria-label="Cerrar">&times;</button>',
      '  </header>',
      '  <form class="lp-login__form">',
      '    <div class="lp-login__body">',
      '      <div class="lp-login__avatar-row">',
      '        <div class="lp-login__avatar"><span class="lp-login__avatar-letter">' + initial + '</span></div>',
      '        <div class="lp-login__field">',
      '          <label class="lp-login__label" for="lp-login-name">Nombre</label>',
      '          <input class="lp-login__input" id="lp-login-name" type="text" autocomplete="name" spellcheck="false" placeholder="¿Cómo te llamas?" value="' + escapeAttr(user ? user.name : '') + '">',
      '          <p class="lp-login__hint" hidden></p>',
      '        </div>',
      '      </div>',
      '      <p class="lp-login__note">' + (isEdit ? 'Este nombre se muestra en todas las apps de LearnFlow.' : 'Tu nombre se sincroniza en todas las apps de LearnFlow.') + '</p>',
      '    </div>',
      '    <footer class="lp-login__footer">',
      '      <button type="submit" class="lp-login__submit">' + (isEdit ? 'Guardar cambios' : 'Continuar') + '</button>',
      isEdit ? '      <button type="button" class="lp-login__logout">Cerrar sesión</button>' : '',
      '    </footer>',
      '  </form>',
      '</div>'
    ].join('\n');

    // Events
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

    // Escape key
    var escHandler = function (e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    return overlay;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ─── Styles ───

  function injectStyles() {
    stylesInjected = true;
    var css = `
/* LP Login Modal */
.lp-login {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.4);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem; z-index: 9999;
  animation: lp-login-in .22s ease-out;
}
.lp-login--closing { animation: lp-login-out .18s ease-in forwards; }

.lp-login__card {
  background: var(--lp-surface, #fff);
  border: 1px solid var(--lp-border, rgba(0,0,0,.08));
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06);
  max-width: 360px; width: 100%;
  overflow: hidden;
  animation: lp-login-card-in .3s cubic-bezier(.2,0,.2,1);
}
.lp-login--closing .lp-login__card {
  animation: lp-login-card-out .18s ease-in forwards;
}

.lp-login__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--lp-border, rgba(0,0,0,.06));
}
.lp-login__title {
  font-size: .95rem; font-weight: 650; color: var(--lp-ink, #1a1a1a);
  margin: 0; letter-spacing: -.01em;
}
.lp-login__close {
  width: 30px; height: 30px; min-width: 30px;
  border-radius: 8px; border: none;
  background: var(--lp-surface-sunken, #f5f5f5);
  color: var(--lp-muted, #888); font-size: 1.2rem;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.lp-login__close:hover { background: var(--lp-border, #e5e5e5); color: var(--lp-ink, #333); }

.lp-login__form { display: flex; flex-direction: column; }
.lp-login__body { padding: 1.25rem; }

.lp-login__avatar-row { display: flex; align-items: center; gap: 1rem; }
.lp-login__avatar {
  width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px color-mix(in srgb, #3b82f6 30%, transparent);
}
.lp-login__avatar-letter {
  font-size: 1.3rem; font-weight: 700; color: #fff;
  text-transform: uppercase; line-height: 1;
}

.lp-login__field { flex: 1; min-width: 0; }
.lp-login__label {
  display: block; font-size: .7rem; font-weight: 600;
  color: var(--lp-muted, #777); text-transform: uppercase;
  letter-spacing: .04em; margin-bottom: .3rem;
}
.lp-login__input {
  width: 100%; padding: .55rem .75rem;
  background: var(--lp-bg, #fafafa);
  border: 1.5px solid var(--lp-border, #e0e0e0);
  border-radius: 8px; font-size: .9rem;
  color: var(--lp-ink, #1a1a1a); outline: none;
  transition: border-color .2s, box-shadow .2s;
  font-family: inherit;
}
.lp-login__input::placeholder { color: var(--lp-muted, #aaa); }
.lp-login__input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px color-mix(in srgb, #3b82f6 12%, transparent);
}
.lp-login__input--error { border-color: var(--lp-error, #e53e3e); }
.lp-login__input--error:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--lp-error, #e53e3e) 12%, transparent); }

.lp-login__hint {
  font-size: .75rem; color: var(--lp-error, #e53e3e);
  margin: .3rem 0 0; font-weight: 500;
}
.lp-login__note {
  font-size: .78rem; color: var(--lp-muted, #888);
  margin: 1rem 0 0; line-height: 1.4;
}

.lp-login__footer {
  padding: 0 1.25rem 1.25rem;
  display: flex; flex-direction: column; gap: .5rem;
}
.lp-login__submit {
  width: 100%; padding: .65rem 1rem;
  border: none; border-radius: 8px;
  font-size: .85rem; font-weight: 600; font-family: inherit;
  background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #fff;
  cursor: pointer; transition: all .15s;
  min-height: 44px;
  box-shadow: 0 2px 8px color-mix(in srgb, #3b82f6 25%, transparent);
}
.lp-login__submit:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 4px 14px color-mix(in srgb, #3b82f6 35%, transparent); }
.lp-login__submit:active { transform: translateY(0); filter: brightness(.97); }

.lp-login__logout {
  width: 100%; padding: .5rem; min-height: 44px;
  border: none; background: transparent;
  color: var(--lp-muted, #888); font-size: .8rem; font-family: inherit;
  cursor: pointer; border-radius: 8px; transition: all .15s;
}
.lp-login__logout:hover { color: var(--lp-error, #e53e3e); background: color-mix(in srgb, var(--lp-error, #e53e3e) 6%, transparent); }

/* Dark mode */
[data-theme="dark"] .lp-login__card { background: var(--lp-surface, #1e1e1e); border-color: rgba(255,255,255,.08); }
[data-theme="dark"] .lp-login__header { border-color: rgba(255,255,255,.06); }
[data-theme="dark"] .lp-login__close { background: rgba(255,255,255,.06); color: var(--lp-muted, #aaa); }
[data-theme="dark"] .lp-login__close:hover { background: rgba(255,255,255,.1); color: #fff; }
[data-theme="dark"] .lp-login__input { background: var(--lp-bg, #111); border-color: rgba(255,255,255,.1); color: var(--lp-ink, #eee); }
[data-theme="dark"] .lp-login__input:focus { border-color: #60a5fa; }

/* Animations */
@keyframes lp-login-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lp-login-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lp-login-card-in { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes lp-login-card-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(8px) scale(.98); } }

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .lp-login, .lp-login__card, .lp-login--closing, .lp-login--closing .lp-login__card { animation: none !important; }
}
`;
    var style = document.createElement('style');
    style.id = 'lp-login-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── Cross-tab sync ───
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      var user = e.newValue ? JSON.parse(e.newValue) : null;
      notify(user);
    }
  });

  return { getUser: getUser, setUser: setUser, logout: logout, open: open, close: close, onUpdate: onUpdate };
})();
