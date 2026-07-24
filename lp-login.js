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
  var navLabelSyncs = [];
  var modalEl = null;

  var GOOGLE_ICON = '<svg class="lp-login__provider-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.78 8.78 0 0 0 2.68-6.61z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.55-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A8.99 8.99 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.72V4.95H.96a8.99 8.99 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
  var MAIL_ICON = '<svg class="lp-login__inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>';
  var CHECK_ICON = '<svg class="lp-login__success-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';

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

    if (wasCloud && window.lpGuestReset && window.lpGuestReset.markExplicitLogout) {
      window.lpGuestReset.markExplicitLogout();
    }

    setUser(null);
    if (window.lpGuestReset) {
      if (wasCloud && window.lpGuestReset.clearGuestLocalProgress) {
        window.lpGuestReset.clearGuestLocalProgress();
      } else if (window.lpGuestReset.clearSharedUserIdentity) {
        window.lpGuestReset.clearSharedUserIdentity();
      }
    }

    if (wasCloud && window.lpSupabase && window.lpSupabase.signOut) {
      Promise.resolve(window.lpSupabase.signOut()).catch(function () {});
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
      var isEditing = !!getUser();
      if (!isEditing) {
        var focusTarget = modalEl.querySelector('.lp-login__magic-input');
        if (focusTarget) focusTarget.focus();
        return;
      }
      var editBtn = modalEl.querySelector('.lp-login__edit-btn');
      if (editBtn && !editBtn.hidden) editBtn.focus();
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
    refreshNavLabels();
  }

  function refreshNavLabels() {
    var user = getUser();
    navLabelSyncs.forEach(function (fn) { fn(user); });
  }

  function switchTab(overlay, tabName) {
    overlay.querySelectorAll('[role="tab"]').forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === tabName;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.classList.toggle('is-active', active);
    });
    overlay.querySelectorAll('[data-panel]').forEach(function (panel) {
      var active = panel.getAttribute('data-panel') === tabName;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    var profileFooter = overlay.querySelector('.lp-login__footer--profile');
    if (profileFooter) {
      profileFooter.classList.toggle('lp-login__footer--cloud-tab', tabName === 'cloud');
      if (tabName === 'cloud') setProfileState(overlay, 'view');
    }
    var focusTarget = overlay.querySelector('[data-panel="' + tabName + '"] .lp-login__magic-input, [data-panel="' + tabName + '"] .lp-login__name-input');
    if (focusTarget) focusTarget.focus();
  }

  function showMagicSuccess(overlay) {
    var formWrap = overlay.querySelector('.lp-login__magic-wrap');
    var success = overlay.querySelector('.lp-login__magic-success');
    if (!formWrap || !success) return;
    formWrap.hidden = true;
    success.hidden = false;
  }

  function buildCloudAuthBlock() {
    return [
      '      <button type="button" class="lp-btn lp-btn--provider lp-login__google">' + GOOGLE_ICON + '<span>Continuar con Google</span></button>',
      '      <div class="lp-login__divider"><span>o con tu correo</span></div>',
      '      <div class="lp-login__magic-wrap">',
      '        <form class="lp-login__magic-form">',
      '          <label class="lp-login__label" for="lp-login-email">Correo electrónico</label>',
      '          <input class="lp-login__input lp-login__magic-input" id="lp-login-email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="tu@email.com">',
      '          <p class="lp-login__magic-status" hidden></p>',
      '          <button type="submit" class="lp-btn lp-btn--primary lp-login__magic-submit">Enviar enlace mágico</button>',
      '        </form>',
      '      </div>',
      '      <div class="lp-login__magic-success" hidden>',
      '        ' + CHECK_ICON,
      '        <h3 class="lp-login__success-title">Revisa tu correo</h3>',
      '      </div>'
    ].join('\n');
  }

  function buildSignupBody() {
    return [
      '    <div class="lp-login__tabs" role="tablist" aria-label="Tipo de acceso">',
      '      <button type="button" class="lp-login__tab is-active" role="tab" aria-selected="true" data-tab="cloud" id="lp-login-tab-cloud" aria-controls="lp-login-panel-cloud">Cuenta</button>',
      '      <button type="button" class="lp-login__tab" role="tab" aria-selected="false" data-tab="guest" id="lp-login-tab-guest" aria-controls="lp-login-panel-guest">Invitado</button>',
      '    </div>',
      '    <div class="lp-login__panel is-active" role="tabpanel" id="lp-login-panel-cloud" data-panel="cloud" aria-labelledby="lp-login-tab-cloud">',
      buildCloudAuthBlock(),
      '    </div>',
      '    <div class="lp-login__panel" role="tabpanel" id="lp-login-panel-guest" data-panel="guest" aria-labelledby="lp-login-tab-guest" hidden>',
      '      <form class="lp-login__form lp-login__guest-form" id="lp-login-form">',
      '        <label class="lp-login__label" for="lp-login-name">¿Cómo te llamamos?</label>',
      '        <input class="lp-login__input lp-login__name-input" id="lp-login-name" type="text" autocomplete="name" spellcheck="false" placeholder="Tu nombre" maxlength="40">',
      '        <p class="lp-login__hint" hidden></p>',
      '        <button type="submit" class="lp-btn lp-btn--primary lp-login__guest-submit">Empezar como invitado</button>',
      '      </form>',
      '    </div>'
    ].join('\n');
  }

  function buildProfileNameForm(user) {
    return [
      '      <form class="lp-login__form lp-login__profile-form" id="lp-login-form">',
      '        <label class="lp-login__label" for="lp-login-name">Nombre</label>',
      '        <input class="lp-login__input lp-login__name-input" id="lp-login-name" type="text" autocomplete="name" spellcheck="false" placeholder="¿Cómo te llamas?" value="' + escapeAttr(user ? user.name : '') + '" maxlength="40">',
      '        <p class="lp-login__hint" hidden></p>',
      '      </form>'
    ].join('\n');
  }

  function buildProfileView(user) {
    return [
      '      <div class="lp-login__profile-view">',
      '        <div class="lp-login__field-display">',
      '          <span class="lp-login__label">Nombre</span>',
      '          <p class="lp-login__value lp-login__name-display">' + escapeAttr(user.name || '') + '</p>',
      '        </div>',
      (user.isSupabaseUser
        ? '        <div class="lp-login__account-card">' + MAIL_ICON + '<div><p class="lp-login__account-label">Cuenta conectada</p><p class="lp-login__account-email">' + escapeAttr(user.email || '') + '</p></div></div>'
        : '        <p class="lp-login__guest-note">Progreso solo en este dispositivo.</p>'),
      '      </div>'
    ].join('\n');
  }

  function buildGuestProfileBody(user) {
    return [
      '    <div class="lp-login__tabs" role="tablist" aria-label="Perfil invitado">',
      '      <button type="button" class="lp-login__tab is-active" role="tab" aria-selected="true" data-tab="profile" id="lp-login-tab-profile" aria-controls="lp-login-panel-profile">Perfil</button>',
      '      <button type="button" class="lp-login__tab" role="tab" aria-selected="false" data-tab="cloud" id="lp-login-tab-profile-cloud" aria-controls="lp-login-panel-profile-cloud">Cuenta</button>',
      '    </div>',
      '    <div class="lp-login__panel is-active" role="tabpanel" id="lp-login-panel-profile" data-panel="profile" aria-labelledby="lp-login-tab-profile">',
      '      <div class="lp-login__profile-shell">',
      buildProfileView(user),
      buildProfileNameForm(user),
      '      </div>',
      '    </div>',
      '    <div class="lp-login__panel" role="tabpanel" id="lp-login-panel-profile-cloud" data-panel="cloud" aria-labelledby="lp-login-tab-profile-cloud" hidden>',
      buildCloudAuthBlock(),
      '    </div>'
    ].join('\n');
  }

  function buildProfileBody(user) {
    if (user.isSupabaseUser) {
      return [
        '    <div class="lp-login__profile-shell">',
        buildProfileView(user),
        buildProfileNameForm(user),
        '    </div>'
      ].join('\n');
    }
    return buildGuestProfileBody(user);
  }

  function getProfileSavedName() {
    var u = getUser();
    return (u && u.name) ? String(u.name).trim() : '';
  }

  function isProfileDirty(overlay) {
    var input = overlay.querySelector('.lp-login__name-input');
    if (!input) return false;
    return input.value.trim() !== getProfileSavedName();
  }

  function syncProfileFooter(overlay) {
    var footer = overlay.querySelector('.lp-login__footer--profile');
    if (!footer) return;
    var dirty = isProfileDirty(overlay);
    footer.classList.toggle('is-dirty', dirty);
    var submitBtn = overlay.querySelector('.lp-login__submit');
    if (submitBtn) submitBtn.disabled = !dirty;
  }

  function setProfileState(overlay, state) {
    var editing = state === 'edit';
    var card = overlay.querySelector('.lp-login__card');
    var footer = overlay.querySelector('.lp-login__footer--profile');
    var nameInput = overlay.querySelector('.lp-login__name-input');

    if (card) card.classList.toggle('lp-login--profile-editing', editing);
    if (footer) footer.setAttribute('data-state', state);
    if (!editing && nameInput) nameInput.value = getProfileSavedName();
    syncProfileFooter(overlay);
  }

  function finishProfileSave(overlay, trimmed) {
    updateProfileDisplay(overlay, trimmed);
    setProfileState(overlay, 'view');
    var editBtnRef = overlay.querySelector('.lp-login__edit-btn');
    if (editBtnRef) editBtnRef.focus();
  }

  function resetProfileSubmitBtn(overlay, submitBtn) {
    if (!submitBtn) return;
    submitBtn.disabled = !isProfileDirty(overlay);
    submitBtn.textContent = 'Guardar cambios';
  }

  function updateProfileDisplay(overlay, name) {
    var display = overlay.querySelector('.lp-login__name-display');
    var avatarLetter = overlay.querySelector('.lp-login__avatar-letter');
    if (display) display.textContent = name;
    if (avatarLetter) avatarLetter.textContent = name ? name[0].toUpperCase() : '?';
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
      '      <p class="lp-login__eyebrow">' + (isEdit ? (user.isSupabaseUser ? 'LearnFlow · Plataforma' : 'Modo invitado') : 'Acceso a LearnFlow') + '</p>',
      '      <h2 class="lp-login__title" id="lp-login-title">' + (isEdit ? 'Tu perfil' : 'Iniciar sesión') + '</h2>',
      '    </div>',
      '    <button type="button" class="lp-login__close" aria-label="Cerrar"><span aria-hidden="true">✕</span></button>',
      '  </header>',
      '  <div class="lp-login__body">',
      isEdit ? buildProfileBody(user) : buildSignupBody(),
      '  </div>',
      isEdit
        ? [
          '  <footer class="lp-login__footer lp-login__footer--profile" data-state="view">',
          '    <div class="lp-login__footer-view">',
          '      <button type="button" class="lp-btn lp-btn--ghost lp-login__edit-btn">Editar</button>',
          user.isSupabaseUser ? '      <button type="button" class="lp-btn lp-btn--ghost lp-login__logout">Cerrar sesión</button>' : '',
          '    </div>',
          '    <div class="lp-login__footer-edit">',
          '      <button type="submit" form="lp-login-form" class="lp-btn lp-btn--primary lp-login__submit">Guardar cambios</button>',
          '    </div>',
          '  </footer>'
        ].join('\n')
        : '  <footer class="lp-login__footer" hidden></footer>',
      '</section>'
    ].join('\n');

    overlay.querySelector('.lp-login__close').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    var nameInput = overlay.querySelector('.lp-login__name-input');
    var hint = overlay.querySelector('.lp-login__hint');
    var avatarLetter = overlay.querySelector('.lp-login__avatar-letter');

    if (nameInput) {
      nameInput.addEventListener('input', function () {
        var val = nameInput.value.trim();
        if (avatarLetter) avatarLetter.textContent = val ? val[0].toUpperCase() : '?';
        if (val.length >= 2) {
          if (hint) hint.hidden = true;
          nameInput.classList.remove('lp-login__input--error');
        }
        syncProfileFooter(overlay);
      });
    }

    var form = overlay.querySelector('.lp-login__profile-form, .lp-login__guest-form');
    if (form && form.classList.contains('lp-login__profile-form')) {
      setProfileState(overlay, 'view');

      var editBtn = overlay.querySelector('.lp-login__edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', function () {
          setProfileState(overlay, 'edit');
          if (nameInput) {
            nameInput.focus();
            nameInput.select();
          }
        });
      }
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!nameInput) return;
        var trimmed = nameInput.value.trim();
        if (trimmed.length < 2) {
          if (hint) {
            hint.textContent = 'Mínimo 2 caracteres';
            hint.hidden = false;
          }
          nameInput.classList.add('lp-login__input--error');
          nameInput.focus();
          return;
        }
        var u = getUser();
        var nextUser = { id: (u && u.id) || String(Date.now()), name: trimmed };
        if (u && u.isSupabaseUser) {
          nextUser.isSupabaseUser = true;
          if (u.email) nextUser.email = u.email;
        }

        if (form.classList.contains('lp-login__profile-form')) {
          var submitBtn = overlay.querySelector('.lp-login__submit');
          if (u && u.isSupabaseUser && window.lpSupabase && window.lpSupabase.updateProfile) {
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.textContent = 'Guardando…';
            }
            window.lpSupabase.updateProfile({ name: trimmed }).then(function (res) {
              resetProfileSubmitBtn(overlay, submitBtn);
              if (res.error) {
                if (hint) {
                  hint.textContent = 'No se pudo guardar: ' + res.error;
                  hint.hidden = false;
                }
                nameInput.classList.add('lp-login__input--error');
                nameInput.focus();
                return;
              }
              setUser(nextUser);
              finishProfileSave(overlay, trimmed);
            });
            return;
          }
          setUser(nextUser);
          finishProfileSave(overlay, trimmed);
          return;
        }

        setUser(nextUser);
        close();
      });
    }

    var logoutBtn = overlay.querySelector('.lp-login__logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logout();
        close();
      });
    }

    overlay.querySelectorAll('[role="tab"]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTab(overlay, tab.getAttribute('data-tab'));
      });
    });

    var googleBtn = overlay.querySelector('.lp-login__google');
    if (googleBtn) {
      googleBtn.addEventListener('click', function () {
        if (!(window.lpSupabase && window.lpSupabase.signInWithGoogle)) return;
        googleBtn.disabled = true;
        googleBtn.querySelector('span').textContent = 'Redirigiendo…';
        document.body.style.overflow = '';
        overlay.classList.add('lp-login--closing');
        window.lpSupabase.signInWithGoogle().catch(function () {
          googleBtn.disabled = false;
          googleBtn.querySelector('span').textContent = 'Continuar con Google';
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
        if (!email) {
          status.hidden = false;
          status.textContent = 'Escribe tu correo para recibir el enlace.';
          magicInput.classList.add('lp-login__input--error');
          magicInput.focus();
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          status.hidden = false;
          status.textContent = 'Correo no válido.';
          magicInput.classList.add('lp-login__input--error');
          magicInput.focus();
          return;
        }
        magicInput.classList.remove('lp-login__input--error');
        status.hidden = true;
        var submitBtn = magicForm.querySelector('.lp-login__magic-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';
        window.lpSupabase.signInWithMagicLink(email).then(function (res) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar enlace mágico';
          if (res.error) {
            status.hidden = false;
            status.textContent = 'No se pudo enviar: ' + res.error.message;
            return;
          }
          showMagicSuccess(overlay);
        });
      });

      var magicInput = magicForm.querySelector('.lp-login__magic-input');
      if (magicInput) {
        magicInput.addEventListener('input', function () {
          magicInput.classList.remove('lp-login__input--error');
          var status = overlay.querySelector('.lp-login__magic-status');
          if (status) status.hidden = true;
        });
      }
    }

    var escHandler = function (e) {
      if (e.key === 'Escape') {
        var profileFooter = overlay.querySelector('.lp-login__footer--profile');
        if (profileFooter && profileFooter.getAttribute('data-state') === 'edit') {
          if (hint) hint.hidden = true;
          if (nameInput) nameInput.classList.remove('lp-login__input--error');
          setProfileState(overlay, 'view');
          var editBtnRef = overlay.querySelector('.lp-login__edit-btn');
          if (editBtnRef) editBtnRef.focus();
          return;
        }
        close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    return overlay;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function injectStyles() {
    var css = `
/* LP Login — unified auth modal (Learn Platform v3) */
.lp-login {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--lp-ink, #2c2418) 45%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: lp-login-in 0.2s ease-out both;
  pointer-events: auto;
}
.lp-login--closing { animation: lp-login-out 0.18s ease-in forwards; }

[data-theme="dark"] .lp-login,
html.dark .lp-login {
  background: color-mix(in srgb, #14171c 58%, transparent);
}

.lp-login__card {
  position: relative;
  width: min(100%, 440px);
  max-height: min(720px, calc(100svh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lp-border, #e8e0d4);
  border-radius: var(--lp-radius-lg, 16px);
  background: var(--lp-bg-paper, var(--lp-surface, #fff));
  box-shadow:
    0 28px 56px color-mix(in srgb, var(--lp-ink, #2c2418) 16%, transparent),
    0 4px 14px color-mix(in srgb, var(--lp-ink, #2c2418) 6%, transparent);
  color: var(--lp-ink-soft, #5e5041);
  animation: lp-login-card-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.lp-login--closing .lp-login__card {
  animation: lp-login-card-out 0.18s ease-in forwards;
}

.lp-login__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--lp-border, #e8e0d4);
  flex-shrink: 0;
}

.lp-login__header-text { flex: 1; min-width: 0; }

.lp-login__identity {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--lp-accent, #2563eb), color-mix(in srgb, var(--lp-accent, #2563eb) 72%, #1e3a8a));
  color: var(--lp-ink-inverse, #fff);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--lp-accent, #2563eb) 24%, transparent);
}

.lp-login__avatar-letter {
  font-size: 1.1rem;
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
  font-size: 1.2rem;
  font-weight: 500;
  line-height: 1.15;
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
  padding: 14px 18px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* Segmented tabs */
.lp-login__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin-bottom: 16px;
  border-radius: var(--lp-radius-md, 10px);
  background: var(--lp-surface-sunken, #f0ede7);
  border: 1px solid var(--lp-border, #e8e0d4);
}

.lp-login__tab {
  min-height: 44px;
  padding: 8px 12px;
  border: none;
  border-radius: calc(var(--lp-radius-md, 10px) - 2px);
  background: transparent;
  color: var(--lp-muted, #9c8e7c);
  font-family: var(--lp-font-body, system-ui, sans-serif);
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}
.lp-login__tab.is-active {
  background: var(--lp-surface, #fff);
  color: var(--lp-ink, #2c2418);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--lp-ink, #2c2418) 8%, transparent);
}
.lp-login__tab:focus-visible {
  outline: 2px solid var(--lp-accent, #2563eb);
  outline-offset: 1px;
}

.lp-login__panel { display: block; }
.lp-login__panel[hidden] { display: none !important; }

.lp-login__lede {
  margin: 0 0 14px;
  font-size: 0.84rem;
  line-height: 1.55;
  color: var(--lp-muted, #9c8e7c);
}

.lp-login__profile-form[hidden],
.lp-login__magic-wrap[hidden] { display: none !important; }

.lp-login__profile-shell {
  display: block;
  min-height: 8rem;
}
.lp-login__profile-view,
.lp-login__form,
.lp-login__magic-form { display: block; }

.lp-login__card:not(.lp-login--profile-editing) .lp-login__profile-form { display: none !important; }
.lp-login__card.lp-login--profile-editing .lp-login__profile-view { display: none !important; }

.lp-login__field-display {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: var(--lp-radius-md, 10px);
  background: var(--lp-surface-sunken, #f0ede7);
  border: 1px solid var(--lp-border, #e8e0d4);
}
.lp-login__value {
  margin: 6px 0 0;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--lp-ink, #2c2418);
  word-break: break-word;
}
.lp-login__guest-note {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: var(--lp-radius-md, 10px);
  background: var(--lp-surface-sunken, #f0ede7);
  border: 1px dashed var(--lp-border, #e8e0d4);
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--lp-muted, #9c8e7c);
  text-align: center;
}

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
  margin: 18px 0 16px;
  color: var(--lp-muted, #9c8e7c);
  font-size: 0.68rem;
  letter-spacing: 0.02em;
}
.lp-login__divider::before,
.lp-login__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--lp-border, #e8e0d4);
}

.lp-login__magic-submit,
.lp-login__guest-submit {
  width: 100%;
  margin-top: 12px;
}

.lp-login__magic-status {
  margin: 8px 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  font-weight: 600;
  color: var(--lp-error, #c0392b);
}

.lp-login__magic-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 4px 4px;
  animation: lp-login-fade-in 0.25s ease both;
}
.lp-login__magic-success[hidden] { display: none !important; }
.lp-login__success-icon {
  color: var(--lp-success, #2d8a4e);
  margin-bottom: 10px;
}
.lp-login__success-title {
  margin: 0;
  font-family: var(--lp-font-display, Georgia, serif);
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--lp-ink, #2c2418);
}

.lp-login__account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: var(--lp-radius-md, 10px);
  background: color-mix(in srgb, var(--lp-accent, #2563eb) 6%, var(--lp-surface-sunken, #f0ede7));
  border: 1px solid color-mix(in srgb, var(--lp-accent, #2563eb) 12%, var(--lp-border, #e8e0d4));
}
.lp-login__inline-icon {
  flex: 0 0 16px;
  color: var(--lp-accent, #2563eb);
}
.lp-login__account-label {
  margin: 0 0 2px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lp-muted, #9c8e7c);
}
.lp-login__account-email {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--lp-ink, #2c2418);
  word-break: break-all;
}

.lp-login__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 18px 18px;
  border-top: 1px solid var(--lp-border, #e8e0d4);
  flex-shrink: 0;
}
.lp-login__footer[hidden] { display: none !important; }
.lp-login__footer--profile.lp-login__footer--cloud-tab { display: none !important; }
.lp-login__footer--profile[data-state="view"] .lp-login__footer-edit { display: none !important; }
.lp-login__footer--profile[data-state="edit"] .lp-login__footer-view { display: none !important; }
.lp-login__footer-view,
.lp-login__footer-edit {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
  width: 100%;
}

.lp-login__footer-view .lp-login__edit-btn,
.lp-login__footer-view .lp-login__logout {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
}
.lp-login__footer-view:not(:has(.lp-login__logout)) .lp-login__edit-btn {
  flex-basis: 100%;
}
.lp-login__footer-edit .lp-login__submit {
  width: 100%;
  flex: 1 1 100%;
}

.lp-login__logout {
  color: var(--lp-muted, #9c8e7c);
}
.lp-login__logout:hover {
  color: var(--lp-error, #c0392b);
  border-color: color-mix(in srgb, var(--lp-error, #c0392b) 28%, transparent);
  background: color-mix(in srgb, var(--lp-error, #c0392b) 6%, var(--lp-surface, #fff));
}

/* LP button primitives */
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
  gap: 8px;
  transition: transform 0.2s cubic-bezier(0.22, 0.9, 0.36, 1), box-shadow 0.2s, border-color 0.2s, color 0.2s, background 0.2s;
}
.lp-login .lp-btn:hover:not(:disabled) { transform: translateY(-2px); }
.lp-login .lp-btn:active:not(:disabled) { transform: translateY(0) scale(0.97); }
.lp-login .lp-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none;
}
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
.lp-login .lp-btn--provider {
  width: 100%;
  background: var(--lp-surface, #fff);
  color: var(--lp-ink, #2c2418);
  border: 1.5px solid var(--lp-border, #e8e0d4);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--lp-ink, #2c2418) 6%, transparent);
}
.lp-login .lp-btn--provider:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--lp-ink, #2c2418) 18%, var(--lp-border, #e8e0d4));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--lp-ink, #2c2418) 8%, transparent);
}
.lp-login .lp-btn:focus-visible {
  outline: 2px solid var(--lp-accent, #2563eb);
  outline-offset: 2px;
}
.lp-login__provider-icon { flex: 0 0 18px; }

/* Dark mode */
[data-theme="dark"] .lp-login__card,
html.dark .lp-login__card {
  background: var(--lp-bg-paper, var(--lp-surface, #252930));
  border-color: var(--lp-border, #353b45);
}
[data-theme="dark"] .lp-login__tabs,
html.dark .lp-login__tabs {
  background: var(--lp-surface-sunken, #14171c);
  border-color: var(--lp-border, #353b45);
}
[data-theme="dark"] .lp-login__tab.is-active,
html.dark .lp-login__tab.is-active {
  background: var(--lp-surface-raised, #2b3038);
  color: var(--lp-ink, #e8eaed);
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
[data-theme="dark"] .lp-login .lp-btn--provider,
html.dark .lp-login .lp-btn--ghost,
html.dark .lp-login .lp-btn--provider {
  background: var(--lp-surface-raised, #2b3038);
  border-color: var(--lp-border, #353b45);
  color: var(--lp-ink-soft, #a8b0bc);
}

@media (max-width: 580px) {
  .lp-login { padding: 16px; align-items: flex-end; }
  .lp-login__card {
    width: 100%;
    max-height: min(92svh, 720px);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .lp-login__body { padding: 12px 14px 16px; }
  .lp-login__footer { padding: 12px 14px max(16px, env(safe-area-inset-bottom)); }
  .lp-login__field-display,
  .lp-login__account-card {
    padding: 12px;
  }
  .lp-login__footer-view {
    flex-direction: column;
    gap: 8px;
  }
  .lp-login__footer-view .lp-login__edit-btn,
  .lp-login__footer-view .lp-login__logout {
    flex-basis: auto;
    width: 100%;
  }
}

@media (min-width: 581px) {
  .lp-login__footer--profile {
    padding: 14px 18px 18px;
  }
}

@keyframes lp-login-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lp-login-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lp-login-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lp-login-card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes lp-login-card-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(10px) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .lp-login, .lp-login__card, .lp-login--closing, .lp-login--closing .lp-login__card,
  .lp-login__magic-success { animation: none !important; }
  .lp-login .lp-btn:hover { transform: none; }
}
`;
    var legacy = document.getElementById('lp-login-styles');
    if (legacy) legacy.remove();
    var style = document.getElementById('lp-login-styles-v3');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lp-login-styles-v3';
      document.head.appendChild(style);
    }
    style.textContent = css;
    document.getElementById('lp-login-styles-v2')?.remove();
  }

  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      var user = null;
      if (e.newValue) {
        try {
          user = JSON.parse(e.newValue);
        } catch (err) {
          user = null;
        }
      }
      notify(user);
    }
  });

  function bindNavButton(selector, options) {
    options = options || {};
    var btn = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!btn) return function () {};
    var labelEl = options.labelSelector
      ? (typeof options.labelSelector === 'string'
          ? btn.querySelector(options.labelSelector)
          : options.labelSelector)
      : btn.querySelector('.nav-label, .sb-label') || btn.querySelector('span:last-child');
    var defaultLabel = options.defaultLabel || 'Iniciar Sesión';

    function syncLabel(user) {
      if (labelEl) labelEl.textContent = user ? user.name : defaultLabel;
      if (options.onSync) options.onSync(user, btn);
    }

    btn.addEventListener('click', function () {
      if (options.beforeOpen) options.beforeOpen();
      open();
    });
    onUpdate(syncLabel);
    navLabelSyncs.push(syncLabel);
    syncLabel(getUser());
    return syncLabel;
  }

  return {
    getUser: getUser,
    setUser: setUser,
    setUserFromSupabase: setUserFromSupabase,
    logout: logout,
    open: open,
    close: close,
    onUpdate: onUpdate,
    bindNavButton: bindNavButton,
    refreshNavLabels: refreshNavLabels
  };
})();
